import hashlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from urllib.request import Request

import sys

sys.path.insert(0, str(Path(__file__).parents[1]))
import intake  # noqa: E402


HOST = "https://commons.wikimedia.org/wiki/Special:FilePath/"


def source(source_id="book-a", expected=None):
    return {
        "id": source_id,
        "url": HOST + source_id + ".pdf",
        "rightsUrl": HOST + source_id + ".html",
        "attribution": "Public source",
        "workGroup": source_id,
        "editionGroup": source_id,
        "lineageGroup": source_id,
        "rights": {
            "acquisition": "approved",
            "training": "public-domain-with-jurisdiction-limit",
            "distribution": "public-domain-with-jurisdiction-limit",
            "basis": "source rights statement",
            "jurisdictions": ["US"],
        },
        "expectedSha256": expected,
    }


class Response:
    def __init__(self, data, *, chunk=1024):
        self.data = data
        self.chunk = chunk
        self.offset = 0

    def read(self, size=-1):
        if self.offset >= len(self.data):
            return b""
        amount = min(size, self.chunk)
        result = self.data[self.offset : self.offset + amount]
        self.offset += len(result)
        return result

    def close(self):
        pass


class Opener:
    def __init__(self, values):
        self.values = values

    def open(self, request: Request, timeout=None):
        return Response(self.values[request.full_url])


class IntakeTests(unittest.TestCase):
    def write_catalog(self, root, entries):
        path = root / "sources.json"
        path.write_text(json.dumps({"schema": 1, "sources": entries}), encoding="utf-8")
        return path

    def test_acquire_verify_and_expected_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = b"%PDF-1.7\npublic bytes"
            item = source(expected=hashlib.sha256(pdf).hexdigest())
            catalog = self.write_catalog(root, [item])
            opener = Opener({item["url"]: pdf, item["rightsUrl"]: b"<html>rights</html>"})
            lock = intake.acquire(catalog, root, opener=opener)
            self.assertEqual(lock["sources"]["book-a"]["original"], "book-a.pdf")
            self.assertEqual(intake.verify(root)["schema"], 1)

    def test_unknown_source_and_url_traversal_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bad_host = source()
            bad_host["url"] = "https://example.invalid/book.pdf"
            with self.assertRaises(intake.IntakeError):
                self.write_catalog(root, [bad_host])
                intake.load_sources(root / "sources.json")
            traversal = source("../escape")
            with self.assertRaises(intake.IntakeError):
                self.write_catalog(root, [traversal])
                intake.load_sources(root / "sources.json")

    def test_corrupt_pdf_and_oversize_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = source()
            catalog = self.write_catalog(root, [item])
            opener = Opener({item["url"]: b"not pdf", item["rightsUrl"]: b"<html>rights</html>"})
            with self.assertRaises(intake.IntakeError):
                intake.acquire(catalog, root, opener=opener)
            oversized = source("large")
            catalog = self.write_catalog(root, [oversized])
            opener = Opener(
                {oversized["url"]: b"%PDF-" + b"x" * (intake.MAX_PDF_BYTES + 1), oversized["rightsUrl"]: b"<html>rights</html>"}
            )
            with self.assertRaises(intake.IntakeError):
                intake.acquire(catalog, root, opener=opener)

    def test_timeout_and_redirect_allowlist(self):
        with self.assertRaises(intake.IntakeError):
            intake._fetch(
                HOST + "x.pdf",
                limit=10,
                deadline=time.monotonic() - 1,
                opener=Opener({HOST + "x.pdf": b"%PDF-"}),
            )
        with self.assertRaises(intake.IntakeError):
            intake._AllowlistedRedirects().redirect_request(
                Request(HOST + "x.pdf"), None, 302, "redirect", {}, "https://evil.invalid/x.pdf"
            )

    def test_recovery_and_non_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = source()
            catalog = self.write_catalog(root, [item])
            pdf = b"%PDF-recover"
            rights = b"<html>rights</html>"
            opener = Opener({item["url"]: pdf, item["rightsUrl"]: rights})
            cache = root / "cache"
            cache.mkdir()
            (cache / "book-a.pdf").write_bytes(pdf)
            lock = intake.acquire(catalog, root, opener=opener)
            self.assertEqual(lock["sources"]["book-a"]["bytes"], len(pdf))
            (cache / "book-a.pdf").write_bytes(b"%PDF-different")
            with self.assertRaises(intake.IntakeError):
                intake.verify(root)

    def test_invalid_rights_aggregate_and_symlink_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = source()
            catalog = self.write_catalog(root, [item])
            opener = Opener({item["url"]: b"%PDF-ok", item["rightsUrl"]: b"bytes"})
            with self.assertRaises(intake.IntakeError):
                intake.acquire(catalog, root, opener=opener)

            original_total = intake.MAX_TOTAL_BYTES
            try:
                intake.MAX_TOTAL_BYTES = 10
                opener = Opener({item["url"]: b"%PDF-ok", item["rightsUrl"]: b"<html>x</html>"})
                with self.assertRaises(intake.IntakeError):
                    intake.acquire(catalog, root / "aggregate", opener=opener)
            finally:
                intake.MAX_TOTAL_BYTES = original_total

            symlink_root = root / "symlink"
            symlink_root.mkdir()
            target = root / "target-cache"
            target.mkdir()
            (symlink_root / "cache").symlink_to(target, target_is_directory=True)
            with self.assertRaises(intake.IntakeError):
                intake.acquire(catalog, symlink_root, opener=Opener({item["url"]: b"%PDF-ok", item["rightsUrl"]: b"<html>x</html>"}))

    def test_stale_catalog_is_rejected_by_verify(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = source()
            catalog = self.write_catalog(root, [item])
            opener = Opener({item["url"]: b"%PDF-ok", item["rightsUrl"]: b"<html>x</html>"})
            intake.acquire(catalog, root, opener=opener)
            changed = source()
            changed["attribution"] = "changed"
            self.write_catalog(root, [changed])
            with self.assertRaises(intake.IntakeError):
                intake.verify(root)


if __name__ == "__main__":
    unittest.main()
