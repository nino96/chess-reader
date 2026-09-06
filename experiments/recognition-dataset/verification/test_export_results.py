import tempfile
from pathlib import Path
from unittest.mock import patch
import unittest

import export_results as subject


class ExportResultsTests(unittest.TestCase):
    def test_public_output_removes_identifying_fields(self):
        value = subject.public({"exactIds": ["private"], "gainedIds": [], "path": "/private/path", "nested": {"sourceId": "private", "ok": 1}})
        self.assertEqual(value, {"nested": {"ok": 1}})

    def test_report_model_hash_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); run = root/'real-only'; run.mkdir()
            (run/'candidate.onnx').write_bytes(b'fixture model')
            (run/'candidate.probabilities.npy').write_bytes(b'fixture probabilities')
            report = {'status':'completed','modelSha256':'0'*64}
            with patch.object(subject, 'RUNS', root), self.assertRaisesRegex(ValueError, 'model identity mismatch'):
                subject.verify_run('real-only', report)

    def test_preflight_rejects_stale_data_lock(self):
        reports = {'pilot': {'dataLock': {'schema':1}}}
        with patch.object(subject, 'read', return_value={'schema':1,'splits':{}}), self.assertRaisesRegex(ValueError, 'report data lock differs'):
            subject.preflight(reports)


if __name__ == "__main__":
    unittest.main()
