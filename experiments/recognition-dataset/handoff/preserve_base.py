"""Publish/restore the exact MIT-licensed shipped-base recovery, never a candidate."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from export_public_records import publish, safe

ROOT = Path(__file__).resolve().parents[1]
SAVED = ROOT / 'handoff' / 'recovery'
LOCAL = ROOT / 'work' / 'modern' / 'base'
HASHES = {
    'fenshot-recovered.pt': 'e0e215b88cd0a927aa713953a1e6342ea19b1624d782a81a1ec843fa3882415f',
    'fenshot-recovered.json': 'e245ffc0ba7b0639e59a4375f7d0345d946b88bdcf5316eaa93b0859f16df524',
}


def verify(directory: Path) -> dict[str, bytes]:
    values = {}
    for name, expected in HASHES.items():
        path = safe(directory, name)
        if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('missing or oversized recovered base')
        payload = path.read_bytes()
        if hashlib.sha256(payload).hexdigest() != expected:
            raise ValueError('recovered base identity differs')
        values[name] = payload
    return values


def transfer(source: Path, destination: Path) -> None:
    values = verify(source)
    # Check every destination before publishing any file. Never replace a run.
    for name, payload in values.items():
        path = safe(destination, name)
        if path.exists() and path.read_bytes() != payload:
            raise ValueError('recovery destination conflict')
    for name, payload in values.items():
        publish(safe(destination, name), payload)
    verify(destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--publish', action='store_true')
    mode.add_argument('--restore', action='store_true')
    mode.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.publish:
        transfer(LOCAL, SAVED)
    elif args.restore:
        transfer(SAVED, LOCAL)
    else:
        verify(SAVED)
    print('Verified exact recovered FENShot base and provenance; no training or reconstruction.')
