#!/usr/bin/env python3
"""Bounded, provenance-first acquisition for the recognition dataset pilot.

This module deliberately has no PDF parser.  It only acquires and locks the
source bytes; extraction is a later, separately bounded stage.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import signal
import sys
import threading
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

ALLOWED_HOSTS = frozenset({"upload.wikimedia.org", "commons.wikimedia.org"})
MAX_OBJECT_SECONDS = 60.0
MAX_PDF_BYTES = 64 * 1024 * 1024
MAX_RIGHTS_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_CATALOG_BYTES = 4 * 1024 * 1024
ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$")


class IntakeError(ValueError):
    """A source or acquisition failed closed validation."""


def _object(value: object, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise IntakeError(f"{field} must be an object")
    return value


def _string(value: object, field: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value):
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
    if parsed.username or parsed.password or port is not None:
        raise IntakeError(f"{field} contains disallowed authority data")
    if parsed.fragment:
        raise IntakeError(f"{field} must not contain a fragment")
    return result


def _sha(value: object, field: str) -> str | None:
    if value is None:
        return None
    result = _string(value, field).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", result):
        raise IntakeError(f"{field} must be a SHA-256 hex digest or null")
    return result


def load_sources(path: Path) -> list[dict[str, object]]:
    """Read and validate the lead-owned public source catalog."""
    try:
        if path.is_symlink() or path.stat().st_size > MAX_CATALOG_BYTES:
            raise IntakeError("source catalog is invalid or oversized")
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise IntakeError("source catalog cannot be read") from exc
    root = _object(value, "catalog")
    if root.get("schema") != 1 or not isinstance(root.get("sources"), list):
        raise IntakeError("catalog schema must be 1 with a sources array")
    if not root["sources"] or len(root["sources"]) > 3:
        raise IntakeError("catalog must contain one to three sources")
    seen: set[str] = set()
    result: list[dict[str, object]] = []
    for index, raw in enumerate(root["sources"]):
        record = _object(raw, f"sources[{index}]")
        source_id = _string(record.get("id"), f"sources[{index}].id")
        if not ID_RE.fullmatch(source_id) or source_id in seen:
            raise IntakeError(f"invalid or duplicate source id: {source_id}")
        seen.add(source_id)
        _url(record.get("url"), f"{source_id}.url")
        _url(record.get("rightsUrl"), f"{source_id}.rightsUrl")
        for field in ("attribution", "workGroup", "editionGroup", "lineageGroup"):
            _string(record.get(field), f"{source_id}.{field}")
        rights = _object(record.get("rights"), f"{source_id}.rights")
        if rights.get("acquisition") != "approved":
            raise IntakeError(f"{source_id}.rights.acquisition must be approved")
        for field in ("training", "distribution", "basis"):
            _string(rights.get(field), f"{source_id}.rights.{field}")
        jurisdictions = rights.get("jurisdictions")
        if not isinstance(jurisdictions, list) or not jurisdictions or not all(
            isinstance(item, str) and item for item in jurisdictions
        ):
            raise IntakeError(f"{source_id}.rights.jurisdictions must be non-empty")
        _sha(record.get("expectedSha256"), f"{source_id}.expectedSha256")
        result.append(record)
    return result


def _validated_url(value: str) -> str:
    # Apply the same checks to redirect targets as to catalog entries.
    return _url(value, "redirect")


class _AllowlistedRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        _validated_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _fetch(
    url: str,
    *,
    limit: int,
    deadline: float,
    opener: object | None = None,
    kind: str = "pdf",
) -> bytes:
    """Fetch one object with a hard byte and wall-time bound.

    ``opener`` is injectable for offline tests and must provide ``open``.
    """
    _validated_url(url)
    request = Request(url, headers={"Accept": "application/pdf,text/html", "User-Agent": "ChessReaderDatasetPilot/1.0 (https://github.com/nino96/chess-reader/issues/41)"})
    client = opener if opener is not None else build_opener(_AllowlistedRedirects())
    try:
        response = client.open(request, timeout=max(0.1, deadline - time.monotonic()))  # type: ignore[attr-defined]
        headers = getattr(response, "headers", None)
        content_type = headers.get_content_type() if headers is not None else None
        if content_type is not None:
            allowed = {"application/pdf"} if kind == "pdf" else {"text/html", "application/xhtml+xml"}
            if content_type not in allowed:
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
        close = getattr(locals().get("response"), "close", None)
        if callable(close):
            close()


def _atomic_publish(path: Path, data: bytes) -> None:
    if path.parent.is_symlink() or path.is_symlink():
        raise IntakeError("refusing symlinked cache artifact")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            if path.read_bytes() == data:
                return
        except OSError as exc:
            raise IntakeError("existing artifact cannot be read") from exc
        raise IntakeError("refusing to overwrite a different artifact")
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            raise IntakeError("refusing to overwrite a concurrently-created artifact")
        finally:
            try:
                os.unlink(temporary)
            except OSError:
                pass
    except OSError as exc:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise IntakeError("artifact publish failed") from exc


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _catalog_identity(sources: list[dict[str, object]]) -> str:
    identities = []
    for source in sources:
        identities.append({key: value for key, value in source.items() if key != "expectedSha256"})
    encoded = json.dumps(identities, sort_keys=True, separators=(",", ":")).encode()
    return _digest(encoded)


@contextlib.contextmanager
def _deadline_signal(deadline: float):
    """Interrupt trickling reads on the main POSIX thread at the wall deadline."""
    if threading.current_thread() is not threading.main_thread() or not hasattr(signal, "setitimer"):
        yield
        return
    previous_handler = signal.getsignal(signal.SIGALRM)

    def alarm(_signum, _frame):  # type: ignore[no-untyped-def]
        raise IntakeError("source acquisition timed out")

    remaining = max(0.001, deadline - time.monotonic())
    signal.signal(signal.SIGALRM, alarm)
    signal.setitimer(signal.ITIMER_REAL, remaining)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def acquire(
    catalog: Path,
    module_dir: Path,
    *,
    opener: object | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, object]:
    """Acquire all catalog entries and atomically create the intake lock."""
    sources = load_sources(catalog)
    cache = module_dir / "cache"
    if cache.exists() and cache.is_symlink():
        raise IntakeError("refusing symlinked cache directory")
    lock_path = cache / "intake-lock.json"
    if lock_path.exists():
        raise IntakeError("refusing to overwrite an existing intake lock")
    total_bytes = 0
    locked: dict[str, object] = {}
    for source in sources:
        source_id = _string(source["id"], "source id")
        started = clock()
        try:
            original = _fetch(
                str(source["url"]),
                limit=min(MAX_PDF_BYTES, MAX_TOTAL_BYTES - total_bytes + 1),
                deadline=clock() + MAX_OBJECT_SECONDS,
                opener=opener,
                kind="pdf",
            )
            if not original.startswith(b"%PDF-"):
                raise IntakeError("source is not a PDF")
            expected = _sha(source.get("expectedSha256"), "expectedSha256")
            original_sha = _digest(original)
            if expected is not None and original_sha != expected:
                raise IntakeError("source SHA-256 does not match catalog")
            total_bytes += len(original)
            rights_limit = min(MAX_RIGHTS_BYTES, MAX_TOTAL_BYTES - total_bytes + 1)
            if rights_limit <= 0:
                raise IntakeError("aggregate source byte limit exceeded")
            rights = _fetch(
                str(source["rightsUrl"]),
                limit=rights_limit,
                deadline=clock() + MAX_OBJECT_SECONDS,
                opener=opener,
                kind="html",
            )
            if not rights:
                raise IntakeError("rights snapshot is empty")
            if b"<" not in rights or b">" not in rights:
                raise IntakeError("rights snapshot is not HTML")
            total_bytes += len(rights)
            if total_bytes > MAX_TOTAL_BYTES:
                raise IntakeError("aggregate source byte limit exceeded")
            _atomic_publish(cache / f"{source_id}.pdf", original)
            _atomic_publish(cache / f"{source_id}.rights.html", rights)
            locked[source_id] = {
                "originalSha256": original_sha,
                "rightsSha256": _digest(rights),
                "bytes": len(original),
                "original": f"{source_id}.pdf",
                "rights": f"{source_id}.rights.html",
                "retrievedAt": _now(),
                "timing": round(clock() - started, 6),
            }
        except IntakeError as exc:
            raise IntakeError(f"acquisition failed for source {source_id}: {exc}") from exc
    lock = {"schema": 1, "sources": locked}
    lock["catalogIdentitySha256"] = _catalog_identity(sources)
    lock["sourceIds"] = sorted(locked)
    _atomic_publish(lock_path, (json.dumps(lock, indent=2, sort_keys=True) + "\n").encode())
    return lock


def verify(module_dir: Path, catalog: Path | None = None) -> dict[str, object]:
    """Verify an existing lock and its local artifacts without network access."""
    lock_path = module_dir / "cache" / "intake-lock.json"
    if lock_path.is_symlink():
        raise IntakeError("refusing symlinked intake lock")
    try:
        if lock_path.stat().st_size > MAX_CATALOG_BYTES:
            raise IntakeError("intake lock is oversized")
        lock = _object(json.loads(lock_path.read_text(encoding="utf-8")), "lock")
    except (OSError, json.JSONDecodeError) as exc:
        raise IntakeError("intake lock cannot be read") from exc
    if lock.get("schema") != 1:
        raise IntakeError("unsupported intake lock schema")
    sources = _object(lock.get("sources"), "lock.sources")
    catalog_path = catalog if catalog is not None else module_dir / "sources.json"
    current_sources = load_sources(catalog_path)
    if lock.get("catalogIdentitySha256") != _catalog_identity(current_sources):
        raise IntakeError("source catalog identity differs from intake lock")
    if lock.get("sourceIds") != sorted(sources) or sorted(sources) != sorted(str(s["id"]) for s in current_sources):
        raise IntakeError("source IDs differ from intake lock")
    for source_id, raw in sources.items():
        if not isinstance(source_id, str) or not ID_RE.fullmatch(source_id):
            raise IntakeError("lock contains an invalid source id")
        record = _object(raw, f"lock.sources.{source_id}")
        original_rel = _string(record.get("original"), "original")
        rights_rel = _string(record.get("rights"), "rights")
        for relative in (original_rel, rights_rel):
            unresolved = module_dir / "cache" / relative
            if unresolved.is_symlink():
                raise IntakeError("symlink artifact rejected")
            path = unresolved.resolve()
            if path.parent != (module_dir / "cache").resolve() or path.is_symlink() or path.name not in {
                f"{source_id}.pdf",
                f"{source_id}.rights.html",
            }:
                raise IntakeError("lock artifact path escapes its source directory")
            if not path.is_file():
                raise IntakeError(f"missing artifact for source {source_id}")
        original = (module_dir / "cache" / original_rel).read_bytes()
        rights = (module_dir / "cache" / rights_rel).read_bytes()
        if _digest(original) != record.get("originalSha256") or _digest(rights) != record.get("rightsSha256"):
            raise IntakeError(f"artifact hash mismatch for source {source_id}")
        if len(original) != record.get("bytes") or not original.startswith(b"%PDF-"):
            raise IntakeError(f"PDF artifact metadata mismatch for source {source_id}")
        source = next(s for s in current_sources if s["id"] == source_id)
        if source.get("expectedSha256") and source["expectedSha256"] != _digest(original):
            raise IntakeError("catalog expected hash differs from locked bytes")
    return lock


def _main(argv: Iterable[str]) -> int:
    parser = argparse.ArgumentParser(description="Acquire or verify the recognition dataset intake cache")
    parser.add_argument("--catalog", type=Path, default=Path(__file__).with_name("sources.json"))
    parser.add_argument("--acquire", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args(list(argv))
    if args.acquire == args.verify:
        parser.error("choose exactly one of --acquire or --verify")
    try:
        result = (
            acquire(args.catalog, Path(__file__).parent)
            if args.acquire
            else verify(Path(__file__).parent, args.catalog)
        )
        print(json.dumps({"status": "ok", "sources": len(result["sources"])}))
        return 0
    except IntakeError as exc:
        print(f"intake failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
