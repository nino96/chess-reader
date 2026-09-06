"""Cheap unit checks for page/crop provenance gates."""
import importlib.util
import unittest
from pathlib import Path


MODULE = Path(__file__).with_name("verify_page_provenance.py")
SPEC = importlib.util.spec_from_file_location("page_provenance", MODULE)
assert SPEC and SPEC.loader
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class ProvenanceGateTests(unittest.TestCase):
    def test_page_gate_rejects_hash_or_size_mismatch(self):
        good = {"byteIdentical": True, "renderedSha256": "a", "retainedSha256": "a", "expectedSha256": "a", "renderedSize": [1, 2], "retainedSize": [1, 2]}
        self.assertTrue(AUDIT.valid_page_result(good))
        for field, value in (("byteIdentical", False), ("expectedSha256", "b"), ("retainedSize", [2, 1])):
            bad = dict(good); bad[field] = value
            self.assertFalse(AUDIT.valid_page_result(bad))

    def test_crop_gate_rejects_replayed_or_manifest_hash_mismatch(self):
        good = {"cropByteIdentical": True, "replayedCropSha256": "a", "cropSha256": "a"}
        self.assertTrue(AUDIT.valid_crop_link(good))
        for field, value in (("cropByteIdentical", False), ("replayedCropSha256", "b"), ("cropSha256", "b")):
            bad = dict(good); bad[field] = value
            self.assertFalse(AUDIT.valid_crop_link(bad))


if __name__ == "__main__":
    unittest.main()
