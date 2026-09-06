import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import sys
sys.path.insert(0, str(Path(__file__).parents[1]))
import modern_extract  # noqa: E402


def png(size=(64, 64)):
    from io import BytesIO
    out = BytesIO(); Image.new("RGB", size, "white").save(out, format="PNG", optimize=False); return out.getvalue()


class ModernExtractTests(unittest.TestCase):
    def test_placement_order_and_validation(self):
        self.assertEqual(modern_extract.placement_cells("K7/8/8/8/8/8/8/7k")[0], "K")
        self.assertEqual(modern_extract.placement_cells("K7/8/8/8/8/8/8/7k")[-1], "k")
        for value in ("8/8/8", "9/8/8/8/8/8/8/8", "8/8/8/8/8/8/8/7x"):
            with self.assertRaises(ValueError): modern_extract.placement_cells(value)

    def test_catalog_rejects_unapproved_and_outside_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / "cache" / "modern").mkdir(parents=True)
            pdf = root / "cache" / "modern" / "source.pdf"; pdf.write_bytes(b"%PDF")
            base = {"id": "source-a", "path": "source.pdf", "pages": [1], "expectedSha256": hashlib.sha256(b"%PDF").hexdigest(), "rights": {"acquisition": "approved"}}
            self.assertEqual(modern_extract.validate_catalog({"sources": [base]}, root)["source-a"]["path"], pdf)
            with self.assertRaises(ValueError): modern_extract.validate_catalog({"sources": [{**base, "rights": {"acquisition": "pending"}}]}, root)
            with self.assertRaises(ValueError): modern_extract.validate_catalog({"sources": [{**base, "path": "/tmp/source.pdf"}]}, root)

    def test_publish_is_immutable_and_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); target = root / "a" / "file"; modern_extract.publish(target, b"a"); modern_extract.publish(target, b"a")
            with self.assertRaises(ValueError): modern_extract.publish(target, b"b")
            link = root / "link"; link.symlink_to(target)
            with self.assertRaises(ValueError): modern_extract.publish(link, b"a")

    def test_verify_requires_review_and_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory); (work / "crops").mkdir()
            crop = png(); (work / "crops" / "board-a.png").write_bytes(crop)
            row = {"id": "board-a", "sourceId": "source-a", "page": 1, "rect": [0, 0, 64, 64], "placement": "8/8/8/8/8/8/8/8", "orientation": "white-bottom", "kind": "board", "family": "family-a", "split": "train", "tags": [], "proposal": {"method": "manual-visual"}, "cropSha256": hashlib.sha256(crop).hexdigest(), "review": {"status": "accepted", "all64": True, "geometry": True}}
            row["proposalSha256"] = hashlib.sha256(modern_extract.json_bytes(modern_extract.canonical_proposal(row))).hexdigest()
            (work / "manifest.json").write_bytes(modern_extract.json_bytes({"schema": 2, "records": [row]}))
            with patch.object(modern_extract, "DEFAULT_WORK", work):
                self.assertEqual(modern_extract.verify(work)["acceptedBoards"], 1)
            row["placement"] = "8/8/8/8/8/8/8/7K"
            (work / "manifest.json").write_bytes(modern_extract.json_bytes({"schema": 2, "records": [row]}))
            with self.assertRaises(ValueError): modern_extract.verify(work)


if __name__ == "__main__":
    unittest.main()
