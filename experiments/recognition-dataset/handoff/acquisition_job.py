"""Detached Linux public-source downloads; no discovery, extraction or inference."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import modern_intake as intake  # noqa: E402
from export_public_records import publish, safe  # noqa: E402

JOB_RE = re.compile(r'^[a-z0-9][a-z0-9-]{7,31}$')
MAX_JOB = 4 * 1024**3
MAX_TRANSFER = 512 * 1024**2
EXPIRY = 48 * 3600
FIELDS = ('id', 'filename', 'rightsFilename', 'expectedSha256', 'expectedRightsSha256', 'url', 'rightsUrl')

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def read(path: Path) -> dict[str, Any]:
    safe(path.parent, path.name)
    if path.stat().st_size > intake.MAX_CATALOG_BYTES: raise ValueError('oversized JSON')
    value = json.loads(path.read_bytes())
    if not isinstance(value, dict): raise ValueError('JSON object required')
    return value

def atomic(path: Path, value: object) -> None:
    safe(path.parent, path.name); path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.state-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

@contextmanager
def locked(path: Path):
    safe(path.parent, path.name); path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('another operation holds the job/storage lock') from None
        yield
    finally:
        os.close(fd)  # Kernel releases on death. Never unlink a lock file.

def valid_name(value: str) -> str:
    if not value or Path(value).name != value or value in {'.', '..'}: raise ValueError('unsafe catalog filename')
    return value

def sources(catalog: Path) -> list[dict[str, str]]:
    safe(catalog.parent, catalog.name)
    values = intake.load_sources(catalog)
    for value in values:
        valid_name(str(value['filename'])); valid_name(str(value['rightsFilename']))
    return [{key: str(value[key]) for key in FIELDS} for value in values]

def proc_start(pid: int) -> str | None:
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().split(') ', 1)[1].split()
        return None if fields[0] == 'Z' else fields[19]
    except (OSError, IndexError): return None

def alive(process: dict[str, Any]) -> bool:
    return (type(process.get('pid')) is int and isinstance(process.get('procStart'), str)
            and proc_start(process['pid']) == process['procStart'])

def job_path(root: Path, job: str) -> Path:
    if not JOB_RE.fullmatch(job): raise ValueError('invalid job id: use 8–32 lowercase letters/digits/hyphens')
    return safe(root, 'work/jobs/' + job)

def safe_tree(root: Path) -> int:
    total = 0
    for name in ('cache', 'work'):
        base = safe(root, name)
        if base.exists():
            for path in base.rglob('*'):
                safe(path.parent, path.name)
                if path.is_file(): total += path.stat().st_size
    return total

def checked_object(path: Path, expected: str, limit: int) -> bytes | None:
    safe(path.parent, path.name)
    if not path.exists(): return None
    if not path.is_file() or path.stat().st_size > limit: raise ValueError('object is not a bounded regular file')
    payload = path.read_bytes()
    if digest(payload) != expected: raise ValueError('existing object hash differs; will not overwrite')
    return payload

def cache_read(root: Path, source: dict[str, str], kind: str) -> bytes | None:
    pdf = kind == 'pdf'
    path = safe(root, ('cache/modern/' if pdf else 'work/modern-intake/') + valid_name(source['filename' if pdf else 'rightsFilename']))
    return checked_object(path, source['expectedSha256' if pdf else 'expectedRightsSha256'], intake.MAX_OBJECT_BYTES if pdf else intake.MAX_RIGHTS_BYTES)

def make_config(root: Path, catalog: Path, job: str) -> dict[str, Any]:
    records = sources(catalog); base = job_path(root, job)
    config = {'schema': 1, 'job': job, 'catalog': str(catalog.absolute()), 'catalogSha256': digest(catalog.read_bytes()),
              'createdAt': time.time(), 'expiresAt': time.time() + EXPIRY, 'sources': records}
    if safe_tree(root) + 1024 * 1024 > MAX_JOB: raise ValueError('aggregate local dataset storage budget exceeded')
    base.mkdir(parents=True, exist_ok=False)
    atomic(base / 'config.json', config)
    atomic(base / 'state.json', {'status': 'queued', 'reservedBytes': 0, 'sources': {r['id']: {'status': 'pending'} for r in records}})
    return config

def verify_config(base: Path) -> dict[str, Any]:
    config = read(base / 'config.json'); catalog = Path(config['catalog']); records = sources(catalog)
    if (config.get('schema') != 1 or config.get('job') != base.name or digest(catalog.read_bytes()) != config.get('catalogSha256') or records != config.get('sources')):
        raise ValueError('catalog/config changed; create a new reviewed job')
    if not isinstance(config.get('expiresAt'), (int, float)): raise ValueError('invalid job deadline')
    return config

def boundary(base: Path, config: dict[str, Any], state: dict[str, Any]) -> bool:
    stop = safe(base, 'stop')
    if time.time() >= config['expiresAt']: state['status'] = 'expired'
    elif stop.exists(): state['status'] = 'stopped'
    else: return False
    atomic(base / 'state.json', state); return True

def worker(root: Path, job: str, opener: object | None = None) -> None:
    base = job_path(root, job)
    # A losing duplicate must not overwrite the active worker's state.
    try:
        with locked(base / '.worker.lock'): run_locked(root, base, opener)
    except ValueError: return

def run_locked(root: Path, base: Path, opener: object | None) -> None:
    state: dict[str, Any] = {'status': 'paused', 'sources': {}, 'reservedBytes': 0}
    try:
        state = read(base / 'state.json'); config = verify_config(base)
        if boundary(base, config, state): return
        if type(state.get('reservedBytes')) is not int or not 0 <= state['reservedBytes'] <= MAX_TRANSFER: raise ValueError('invalid transfer reservation ledger')
        state['status'] = 'running'; state.pop('error', None); atomic(base / 'state.json', state)
        for source in config['sources']:
            sid = source['id']; entry = state['sources'][sid]; size = 0
            # Recheck completed sources on resume, not just their status string.
            for kind, url, limit, expected, filename in (
                ('pdf', source['url'], intake.MAX_OBJECT_BYTES, source['expectedSha256'], 'original.pdf'),
                ('html', source['rightsUrl'], intake.MAX_RIGHTS_BYTES, source['expectedRightsSha256'], 'rights.bin')):
                if boundary(base, config, state): return
                target = safe(base, f'objects/{sid}/{filename}')
                with locked(safe(root, 'work/jobs/.storage.lock')):
                    data = checked_object(target, expected, limit)
                    if data is None:
                        data = cache_read(root, source, kind)
                        if data is None:
                            reservation = state['reservedBytes'] + limit
                            if reservation > MAX_TRANSFER: raise ValueError('transfer reservation budget exhausted')
                            if safe_tree(root) + limit + 1024 * 1024 > MAX_JOB: raise ValueError('aggregate storage budget exceeded')
                            state['reservedBytes'] = reservation; atomic(base / 'state.json', state)
                            data = intake._fetch(url, limit=limit,
                                deadline=time.monotonic() + min(intake.MAX_OBJECT_SECONDS, max(0.001, config['expiresAt'] - time.time())),
                                opener=opener, kind=kind)
                        if digest(data) != expected: raise ValueError(f'{sid} {kind} hash mismatch')
                        if safe_tree(root) + len(data) + 1024 * 1024 > MAX_JOB: raise ValueError('aggregate storage budget exceeded')
                        if kind == 'pdf' and not data.startswith(b'%PDF-'): raise ValueError('download is not PDF')
                        publish(target, data)
                    if kind == 'pdf' and not data.startswith(b'%PDF-'): raise ValueError('cached object is not PDF')
                    size += len(data)
                if boundary(base, config, state): return
            entry.update(status='completed', bytes=size, completedAt=time.time()); atomic(base / 'state.json', state)
        state['status'] = 'completed'; atomic(base / 'state.json', state)
    except Exception as error:
        state['status'] = 'paused'; state['error'] = str(error); atomic(base / 'state.json', state)

def spawn(root: Path, job: str) -> dict[str, Any]:
    base = job_path(root, job)
    proc = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--worker', '--root', str(root.absolute()), '--job', job],
        cwd=str(root), start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atomic(base / 'process.json', {'pid': proc.pid, 'procStart': proc_start(proc.pid)})
    return {'job': job, 'status': 'queued'}

def start(root: Path, catalog: Path, job: str) -> dict[str, Any]:
    make_config(root, catalog, job)
    with locked(job_path(root, job) / '.control.lock'): return spawn(root, job)

def resume(root: Path, catalog: Path, job: str) -> dict[str, Any]:
    base = job_path(root, job)
    with locked(base / '.control.lock'):
        config = verify_config(base); safe(catalog.parent, catalog.name)
        if digest(catalog.read_bytes()) != config['catalogSha256']: raise ValueError('catalog changed; resume refused')
        if status(root, job)['workerRunning']: raise ValueError('worker is already active')
        with locked(base / '.worker.lock'):
            state = read(base / 'state.json')
            if state.get('status') in {'completed', 'expired'}: raise ValueError('terminal job cannot resume')
            if time.time() >= config['expiresAt']:
                state['status'] = 'expired'; atomic(base / 'state.json', state); raise ValueError('job expired')
            stop = safe(base, 'stop')
            if stop.exists(): stop.unlink()
        return spawn(root, job)

def status(root: Path, job: str) -> dict[str, Any]:
    base = job_path(root, job); state = read(base / 'state.json')
    process = read(base / 'process.json') if safe(base, 'process.json').exists() else {}
    return {'job': job, 'status': state.get('status'), 'workerRunning': alive(process), 'error': state.get('error'),
            'reservedBytes': state.get('reservedBytes'), 'sources': state.get('sources')}

def stop(root: Path, job: str) -> dict[str, Any]:
    base = job_path(root, job); read(base / 'config.json'); publish(safe(base, 'stop'), b'')
    return status(root, job)

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT); parser.add_argument('--catalog', type=Path, default=ROOT / 'modern-sources.json'); parser.add_argument('--job')
    mode = parser.add_mutually_exclusive_group(required=True)
    for action in ('start', 'status', 'stop', 'resume', 'worker'): mode.add_argument('--' + action, action='store_true')
    args = parser.parse_args()
    if not args.job and not args.start: parser.error('--job is required except for --start')
    job = args.job or secrets.token_hex(6)
    if args.worker: worker(args.root, job)
    else:
        result = start(args.root, args.catalog, job) if args.start else resume(args.root, args.catalog, job) if args.resume else stop(args.root, job) if args.stop else status(args.root, job)
        print(json.dumps(result, sort_keys=True))

if __name__ == '__main__': main()
