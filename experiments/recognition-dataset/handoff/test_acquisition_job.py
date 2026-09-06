import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acquisition_job as job


class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='chess-job-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.catalog = self.root / 'catalog.json'
        self.pdf, self.rights = b'%PDF-1.4\nsynthetic fixture', b'<html>synthetic rights fixture</html>'
        source = json.loads((job.ROOT / 'modern-sources.json').read_text())['sources'][0]
        source.update(id='public-fixture', filename='fixture.pdf', rightsFilename='rights.html',
                      expectedSha256=job.digest(self.pdf), expectedRightsSha256=job.digest(self.rights))
        self.source = source
        self.catalog.write_text(json.dumps({'schema': 1, 'sources': [source]}))
        self.name = 'publicbatch01'
        self.base = job.job_path(self.root, self.name)

    def cache(self):
        for relative, payload in [('cache/modern/fixture.pdf', self.pdf), ('work/modern-intake/rights.html', self.rights)]:
            path = self.root / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(payload)

    def prepare(self):
        job.make_config(self.root, self.catalog, self.name)

    def state(self):
        return job.read(self.base / 'state.json')

    def test_cache_completion_job_only_and_rehash_completed(self):
        self.cache(); self.prepare()
        with patch.object(job.intake, '_fetch', side_effect=AssertionError('network forbidden')):
            job.worker(self.root, self.name)
        self.assertEqual(self.state()['status'], 'completed')
        self.assertEqual(self.state()['reservedBytes'], 0)
        output = self.base / 'objects/public-fixture/original.pdf'
        self.assertEqual(output.read_bytes(), self.pdf)
        output.write_bytes(b'tamper')
        job.worker(self.root, self.name)
        self.assertEqual(self.state()['status'], 'paused')
        self.assertIn('hash differs', self.state()['error'])
        self.assertEqual(output.read_bytes(), b'tamper')

    def test_download_failure_is_charged_and_transfer_budget_blocks_retry(self):
        self.prepare()
        with patch.object(job.intake, '_fetch', return_value=b'%PDF-wrong') as fetch:
            job.worker(self.root, self.name)
            self.assertEqual(fetch.call_count, 1)
        self.assertEqual(self.state()['reservedBytes'], job.intake.MAX_OBJECT_BYTES)
        self.assertIn('hash mismatch', self.state()['error'])
        with patch.object(job, 'MAX_TRANSFER', job.intake.MAX_OBJECT_BYTES), patch.object(job.intake, '_fetch') as fetch:
            job.worker(self.root, self.name); fetch.assert_not_called()
        self.assertIn('transfer reservation', self.state()['error'])

    def test_cache_cannot_bypass_aggregate_storage_budget(self):
        self.cache(); self.prepare()
        with patch.object(job, 'MAX_JOB', job.safe_tree(self.root) + len(self.pdf)):
            job.worker(self.root, self.name)
        self.assertEqual(self.state()['status'], 'paused')
        self.assertIn('storage budget', self.state()['error'])

    def test_stale_catalog_and_modified_config_fail_closed(self):
        self.prepare()
        self.catalog.write_text(self.catalog.read_text() + '\n')
        job.worker(self.root, self.name)
        self.assertEqual(self.state()['status'], 'paused')
        with self.assertRaises(ValueError): job.resume(self.root, self.catalog, self.name)

    def test_expiry_and_stop_boundaries(self):
        self.prepare(); job.stop(self.root, self.name); job.worker(self.root, self.name)
        self.assertEqual(self.state()['status'], 'stopped')
        config = job.read(self.base / 'config.json'); config['expiresAt'] = 0
        job.atomic(self.base / 'config.json', config); job.worker(self.root, self.name)
        self.assertEqual(self.state()['status'], 'expired')

    def test_stop_after_first_object_retains_hash_checked_progress(self):
        self.prepare()
        def fetch(*args, **kwargs):
            job.stop(self.root, self.name)
            return self.pdf
        with patch.object(job.intake, '_fetch', side_effect=fetch) as request:
            job.worker(self.root, self.name)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(self.state()['status'], 'stopped')
        self.assertEqual((self.base / 'objects/public-fixture/original.pdf').read_bytes(), self.pdf)

    def test_worker_lock_rejects_duplicate_without_state_changes(self):
        self.prepare(); before = (self.base / 'state.json').read_bytes()
        with job.locked(self.base / '.worker.lock'):
            job.worker(self.root, self.name)
            with self.assertRaises(ValueError): job.resume(self.root, self.catalog, self.name)
        self.assertEqual(before, (self.base / 'state.json').read_bytes())

    def test_dead_pid_is_not_alive_and_live_pid_blocks_resume(self):
        self.prepare()
        job.atomic(self.base / 'process.json', {'pid': 99999999, 'procStart': None})
        self.assertFalse(job.status(self.root, self.name)['workerRunning'])
        job.atomic(self.base / 'process.json', {'pid': os.getpid(), 'procStart': job.proc_start(os.getpid())})
        with self.assertRaisesRegex(ValueError, 'active'): job.resume(self.root, self.catalog, self.name)

    def test_symlink_ancestor_and_invalid_ids_rejected(self):
        for name in ('../escape', 'short', 'has/slash00'):
            with self.assertRaises(ValueError): job.job_path(self.root, name)
        for name in ('0123456789ab', self.name): job.job_path(self.root, name)
        (self.root / 'work').symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError): self.prepare()

    def test_actual_detached_start(self):
        self.cache(); processes = []; original = subprocess.Popen
        def capture(*args, **kwargs):
            proc = original(*args, **kwargs); processes.append(proc); return proc
        with patch.object(job.subprocess, 'Popen', side_effect=capture):
            job.start(self.root, self.catalog, self.name)
        self.assertEqual(processes[0].wait(timeout=5), 0)
        self.assertEqual(job.status(self.root, self.name)['status'], 'completed')

    def test_actual_detached_status_and_stop_resume(self):
        self.cache(); self.prepare(); job.stop(self.root, self.name)
        job.worker(self.root, self.name)
        processes = []
        original = subprocess.Popen
        def capture(*args, **kwargs):
            proc = original(*args, **kwargs); processes.append(proc); return proc
        with patch.object(job.subprocess, 'Popen', side_effect=capture):
            job.resume(self.root, self.catalog, self.name)
        self.assertEqual(processes[0].wait(timeout=5), 0)
        result = job.status(self.root, self.name)
        self.assertEqual(result['status'], 'completed')
        self.assertFalse(result['workerRunning'])
        self.assertNotIn('error', self.state())
        with self.assertRaisesRegex(ValueError, 'terminal'): job.resume(self.root, self.catalog, self.name)


if __name__ == '__main__': unittest.main()
