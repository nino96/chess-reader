import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).parents[1]))
import modern_intake  # noqa: E402


class Response:
    def __init__(self, data):
        self.data = data
        self.offset = 0

    def read(self, size=-1):
        if self.offset >= len(self.data):
            return b""
        result = self.data[self.offset : self.offset + size]
        self.offset += len(result)
        return result

    def close(self):
        pass


class Opener:
    def __init__(self, values):
        self.values = values

    def open(self, request: Request, timeout=None):
        return Response(self.values[request.full_url])


def source(source_id="modern-a", pdf=b"%PDF-1.7\nsource", rights=b"<html>rights</html>"):
    return {
        "id": source_id,
        "url": f"https://upload.wikimedia.org/wikipedia/commons/{source_id}.pdf",
        "rightsUrl": f"https://commons.wikimedia.org/wiki/File:{source_id}.pdf",
        "filename": f"{source_id}.pdf",
        "rightsFilename": f"{source_id}.rights.html",
        "attribution": "Source author",
        "workGroup": source_id,
        "editionGroup": source_id,
        "lineageGroup": source_id,
        "expectedSha256": hashlib.sha256(pdf).hexdigest(),
        "expectedRightsSha256": hashlib.sha256(rights).hexdigest(),
        "rights": {
            "acquisition": "approved",
            "evaluation": "approved",
            "training": "conditional",
            "cropRedistribution": "review-required",
            "modelPublication": "review-required",
            "basis": "source license",
            "jurisdictions": ["worldwide subject to source license"],
        },
    }


class ModernIntakeTests(unittest.TestCase):
    def write_catalog(self, root, entries):
        path = root / "modern-sources.json"
        path.write_text(json.dumps({"schema": 1, "sources": entries}), encoding="utf-8")
        return path

    def test_catalog_contains_separate_rights_decisions(self):
        catalog = Path(__file__).parents[1] / "modern-sources.json"
        entries = modern_intake.load_sources(catalog)
        self.assertEqual(len(entries), 5)
        for item in entries:
            rights = item["rights"]
            self.assertIn("evaluation", rights)
            self.assertIn("training", rights)
            self.assertIn("cropRedistribution", rights)
            self.assertIn("modelPublication", rights)

    def test_acquire_hashes_and_verifies_without_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = source()
            catalog = self.write_catalog(root, [item])
            opener = Opener({item["url"]: b"%PDF-1.7\nsource", item["rightsUrl"]: b"<html>rights</html>"})
            lock = modern_intake.acquire(catalog, root, opener=opener)
            self.assertEqual(lock["sources"]["modern-a"]["bytes"], len(b"%PDF-1.7\nsource"))
            self.assertEqual(modern_intake.verify(catalog, root)["schema"], 1)
            with self.assertRaises(modern_intake.IntakeError):
                modern_intake.acquire(catalog, root, opener=opener)

    def test_unallowlisted_url_and_redirect_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = source()
            item["url"] = "https://example.invalid/source.pdf"
            with self.assertRaises(modern_intake.IntakeError):
                modern_intake.load_sources(self.write_catalog(root, [item]))
        with self.assertRaises(modern_intake.IntakeError):
            modern_intake._AllowlistedRedirects().redirect_request(
                Request("https://upload.wikimedia.org/wikipedia.org/x.pdf"),
                None,
                302,
                "redirect",
                {},
                "https://evil.invalid/x.pdf",
            )

    def test_catalog_limit_and_hash_mismatch_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entries = [source(f"modern-{index}") for index in range(modern_intake.MAX_SOURCES + 1)]
            with self.assertRaises(modern_intake.IntakeError):
                modern_intake.load_sources(self.write_catalog(root, entries))
            item = source()
            item["expectedSha256"] = "0" * 64
            catalog = self.write_catalog(root, [item])
            opener = Opener({item["url"]: b"%PDF-1.7\nsource", item["rightsUrl"]: b"<html>rights</html>"})
            with self.assertRaises(modern_intake.IntakeError):
                modern_intake.acquire(catalog, root, opener=opener)


if __name__ == "__main__":
    unittest.main()
