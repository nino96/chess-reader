#!/usr/bin/env python3
"""Bounded intake for modern/open chess-document sources.

This is deliberately separate from the historical Commons pilot intake: it
has a different allowlist, source count and byte budget. It acquires only
catalogued public objects and records independent decisions for evaluation,
training, crop redistribution and model publication.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

ALLOWED_HOSTS = frozenset(
    {
        "upload.wikimedia.org",
        "commons.wikimedia.org",
        "mirrors.ctan.org",
        "ctan.org",
        "ctan.math.illinois.edu",
        "journals.plos.org",
    }
)
MAX_SOURCES = 10
MAX_OBJECT_SECONDS = 60.0
MAX_OBJECT_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_RIGHTS_BYTES = 4 * 1024 * 1024
MAX_CATALOG_BYTES = 4 * 1024 * 1024
ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$")


class IntakeError(ValueError):
    """A catalog or acquisition failed closed validation."""


def _object(value: object, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise IntakeError(f"{field} must be an object")
    return value


def _string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise IntakeError(f"{field} must be a non-empty string")
    return value


def _url(value: object, field: str) -> str:
    result = _string(value, field)
    parsed = urlparse(result)
    try:
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise IntakeError(f"{field} authority is invalid") from exc
    if parsed.scheme != "https" or hostname not in ALLOWED_HOSTS:
        raise IntakeError(f"{field} host or scheme is not allowlisted")
    if parsed.username or parsed.password or port is not None or parsed.fragment:
        raise IntakeError(f"{field} contains disallowed authority data")
    return result


def _sha(value: object, field: str) -> str:
    result = _string(value, field).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", result):
        raise IntakeError(f"{field} must be a SHA-256 hex digest")
    return result


def load_sources(path: Path) -> list[dict[str, object]]:
    """Validate a modern source catalog before any network access."""
    try:
        if path.is_symlink() or path.stat().st_size > MAX_CATALOG_BYTES:
            raise IntakeError("source catalog is invalid or oversized")
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise IntakeError("source catalog cannot be read") from exc
    root = _object(value, "catalog")
    sources = root.get("sources")
    if root.get("schema") != 1 or not isinstance(sources, list) or not sources:
        raise IntakeError("catalog schema must be 1 with a non-empty sources array")
    if len(sources) > MAX_SOURCES:
        raise IntakeError("catalog exceeds modern source limit")
    seen: set[str] = set()
    result: list[dict[str, object]] = []
    for index, raw in enumerate(sources):
        record = _object(raw, f"sources[{index}]")
        source_id = _string(record.get("id"), f"sources[{index}].id")
        if not ID_RE.fullmatch(source_id) or source_id in seen:
            raise IntakeError(f"invalid or duplicate source id: {source_id}")
        seen.add(source_id)
        _url(record.get("url"), f"{source_id}.url")
        _url(record.get("rightsUrl"), f"{source_id}.rightsUrl")
        for field in ("attribution", "workGroup", "editionGroup", "lineageGroup", "filename", "rightsFilename"):
            _string(record.get(field), f"{source_id}.{field}")
        rights = _object(record.get("rights"), f"{source_id}.rights")
        if rights.get("acquisition") != "approved":
            raise IntakeError(f"{source_id}.rights.acquisition must be approved")
        for field in ("evaluation", "training", "cropRedistribution", "modelPublication", "basis"):
            _string(rights.get(field), f"{source_id}.rights.{field}")
        jurisdictions = rights.get("jurisdictions")
        if not isinstance(jurisdictions, list) or not jurisdictions or not all(
            isinstance(item, str) and item for item in jurisdictions
        ):
            raise IntakeError(f"{source_id}.rights.jurisdictions must be non-empty")
        _sha(record.get("expectedSha256"), f"{source_id}.expectedSha256")
        _sha(record.get("expectedRightsSha256"), f"{source_id}.expectedRightsSha256")
        result.append(record)
    return result


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _validated_url(value: str) -> str:
    return _url(value, "redirect")


class _AllowlistedRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        _validated_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@contextmanager
def _deadline_signal(deadline: float):
    if threading.current_thread() is not threading.main_thread() or not hasattr(signal, "setitimer"):
        yield
        return
    previous = signal.getsignal(signal.SIGALRM)

    def alarm(_signum, _frame):  # type: ignore[no-untyped-def]
        raise IntakeError("source acquisition timed out")

    signal.signal(signal.SIGALRM, alarm)
    signal.setitimer(signal.ITIMER_REAL, max(0.001, deadline - time.monotonic()))
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def _fetch(url: str, *, limit: int, deadline: float, opener: object | None, kind: str) -> bytes:
    _validated_url(url)
    request = Request(url, headers={"Accept": "application/pdf,text/html", "User-Agent": "ChessReaderModernIntake/1.0 (issue-41)"})
    client = opener if opener is not None else build_opener(_AllowlistedRedirects())
    response = None
    try:
        response = client.open(request, timeout=max(0.1, deadline - time.monotonic()))  # type: ignore[attr-defined]
        headers = getattr(response, "headers", None)
        content_type = headers.get_content_type() if headers is not None else None
        allowed = {"application/pdf"} if kind == "pdf" else {"text/html", "application/xhtml+xml", "text/plain", "application/octet-stream"}
        if content_type is not None and content_type not in allowed:
            raise IntakeError("source content type is not allowed")
        chunks: list[bytes] = []
        total = 0
        with _deadline_signal(deadline):
            while True:
                if time.monotonic() >= deadline:
                    raise IntakeError("source acquisition timed out")
                chunk = response.read(min(1024 * 1024, limit - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise IntakeError("source object exceeds its byte limit")
                chunks.append(chunk)
        return b"".join(chunks)
    except IntakeError:
        raise
    except (OSError, HTTPError, URLError, TimeoutError) as exc:
        raise IntakeError("source acquisition failed") from exc
    finally:
        if response is not None:
            response.close()


def _atomic_publish(path: Path, data: bytes) -> None:
    if path.parent.is_symlink() or path.is_symlink():
        raise IntakeError("refusing symlinked cache artifact")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() == data:
            return
        raise IntakeError("refusing to overwrite a different artifact")
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
    except FileExistsError as exc:
        raise IntakeError("refusing to overwrite a concurrently-created artifact") from exc
    except OSError as exc:
        raise IntakeError("artifact publish failed") from exc
    finally:
        try:
            os.unlink(temporary)
        except OSError:
            pass


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def acquire(catalog: Path, root: Path, *, opener: object | None = None) -> dict[str, object]:
    sources = load_sources(catalog)
    cache = root / "cache" / "modern"
    work = root / "work" / "modern-intake"
    lock_path = work / "intake-lock.json"
    if lock_path.exists() or lock_path.is_symlink() or work.is_symlink():
        raise IntakeError("refusing to overwrite an existing modern intake lock")
    total = 0
    locked: dict[str, object] = {}
    for source in sources:
        source_id = str(source["id"])
        original: bytes | None = None
        rights: bytes | None = None
        last_error: Exception | None = None
        for _attempt in range(2):
            try:
                original = _fetch(str(source["url"]), limit=MAX_OBJECT_BYTES, deadline=time.monotonic() + MAX_OBJECT_SECONDS, opener=opener, kind="pdf")
                if not original.startswith(b"%PDF-"):
                    raise IntakeError("source is not a PDF")
                rights = _fetch(str(source["rightsUrl"]), limit=MAX_RIGHTS_BYTES, deadline=time.monotonic() + MAX_OBJECT_SECONDS, opener=opener, kind="html")
                break
            except IntakeError as exc:
                last_error = exc
                original = rights = None
        if original is None or rights is None:
            raise IntakeError(f"{source_id} acquisition failed") from last_error
        total += len(original) + len(rights)
        if total > MAX_TOTAL_BYTES:
            raise IntakeError("modern intake exceeds aggregate byte limit")
        if _digest(original) != source["expectedSha256"] or _digest(rights) != source["expectedRightsSha256"]:
            raise IntakeError(f"{source_id} SHA-256 does not match catalog")
        _atomic_publish(cache / str(source["filename"]), original)
        _atomic_publish(work / str(source["rightsFilename"]), rights)
        locked[source_id] = {
            "original": str(source["filename"]),
            "rights": str(source["rightsFilename"]),
            "bytes": len(original),
            "rightsBytes": len(rights),
            "sha256": _digest(original),
            "rightsSha256": _digest(rights),
        }
    lock = {"schema": 1, "catalog": str(catalog), "acquiredAt": _now(), "sources": locked}
    encoded = (json.dumps(lock, sort_keys=True, indent=2) + "\n").encode()
    _atomic_publish(lock_path, encoded)
    return lock


def verify(catalog: Path, root: Path) -> dict[str, object]:
    sources = load_sources(catalog)
    lock_path = root / "work" / "modern-intake" / "intake-lock.json"
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise IntakeError("modern intake lock cannot be read") from exc
    if lock.get("schema") != 1 or not isinstance(lock.get("sources"), dict):
        raise IntakeError("modern intake lock is invalid")
    if set(lock["sources"]) != {str(source["id"]) for source in sources}:
        raise IntakeError("modern intake lock does not match catalog")
    for source in sources:
        source_id = str(source["id"])
        item = _object(lock["sources"][source_id], f"lock.{source_id}")
        original = root / "cache" / "modern" / _string(item.get("original"), f"lock.{source_id}.original")
        rights = root / "work" / "modern-intake" / _string(item.get("rights"), f"lock.{source_id}.rights")
        if _digest(original.read_bytes()) != source["expectedSha256"] or _digest(rights.read_bytes()) != source["expectedRightsSha256"]:
            raise IntakeError(f"{source_id} artifact hash mismatch")
    return lock


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path(__file__).with_name("modern-sources.json"))
    parser.add_argument("--root", type=Path, default=Path(__file__).parent)
    parser.add_argument("--acquire", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.acquire == args.verify:
        parser.error("choose exactly one of --acquire or --verify")
    try:
        result = acquire(args.catalog, args.root) if args.acquire else verify(args.catalog, args.root)
    except IntakeError as exc:
        print(f"modern intake failed: {exc}", flush=True)
        return 1
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
