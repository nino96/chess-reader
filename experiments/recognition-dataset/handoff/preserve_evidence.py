"""Preserve immutable public freeze/provenance evidence, without image payloads."""
import argparse
import hashlib
import json
from pathlib import Path

from export_public_records import publish, safe, validate_public

ROOT = Path(__file__).resolve().parents[1]
HASHES = {
    'pretraining-lock.json': 'b24b5143e599ed0d1cb1cbd322e9052348de200da47fc110b529498a7c02c814',
    'page-provenance-audit.json': 'c77b6325197e23a721cea559839723dda8676bfd093c78f3c8db7f56ec79b22f',
}


def preserve(verify: bool) -> None:
    for name, expected in HASHES.items():
        source = safe(ROOT / ('handoff/evidence' if verify else 'work/modern'), name)
        if not source.is_file() or source.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('missing or oversized evidence')
        payload = source.read_bytes()
        if hashlib.sha256(payload).hexdigest() != expected:
            raise ValueError('evidence hash differs')
        value = json.loads(payload)
        if name == 'page-provenance-audit.json':
            # This public executable identity is not a personal workspace path.
            if value['renderer'].pop('path') != '/usr/bin/pdftoppm':
                raise ValueError('unexpected renderer path')
        validate_public(value, enforce_sources=False)
        if not verify:
            publish(safe(ROOT / 'handoff/evidence', name), payload)
    print('Verified two immutable public evidence snapshots.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--publish', action='store_true')
    mode.add_argument('--verify', action='store_true')
    preserve(parser.parse_args().verify)
