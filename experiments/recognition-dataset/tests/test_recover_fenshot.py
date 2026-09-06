import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

import sys
sys.path.insert(0, str(Path(__file__).parents[1]))
import recover_fenshot as subject  # noqa: E402


class RecoverFenshotTests(unittest.TestCase):
    def test_load_recovered_requires_state_hash_and_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            shipped = base / "model.onnx"
            shipped.write_bytes(b"model")
            state = base / subject.STATE_NAME
            import torch
            torch.save({"schema": 1, "state": subject.LogitTileNet().state_dict()}, state)
            report = {
                "schema": 1,
                "stateSha256": subject.sha256(state),
                "shippedSha256": subject.sha256(shipped),
                "devTilesSha256": "x",
                "devMetadataSha256": "y",
                "trainerSha256": subject.sha256(subject.V3 / "trainer.py"),
                "reconstructSha256": subject.sha256(subject.PLANNING / "reconstruct_parity.py"),
                "parity": {"identicalArgmax": True, "atol": 1e-5, "rtol": 1e-5},
            }
            (base / subject.REPORT_NAME).write_text(json.dumps(report), encoding="utf-8")
            model = subject.load_recovered(base, shipped)
            self.assertEqual(sum(value.numel() for value in model.parameters()), subject.EXPECTED_PARAMETERS)
            shipped.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                subject.load_recovered(base, shipped)
            shipped.write_bytes(b"model")
            report.pop("parity")
            (base / subject.REPORT_NAME).write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaises(ValueError):
                subject.load_recovered(base, shipped)
            report["parity"] = {"identicalArgmax": True}
            report["stateSha256"] = "0" * 64
            (base / subject.REPORT_NAME).write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaises(ValueError):
                subject.load_recovered(base, shipped)

    def test_dev_loader_rejects_wrong_tensor_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            np.savez(root / "dev.npz", tiles=np.zeros((1, 64, 16), dtype=np.float32), labels=np.zeros((1, 64), dtype=np.int64))
            (root / "dev.metadata.json").write_text("{}", encoding="utf-8")
            with self.assertRaises(ValueError):
                subject._dev(root)


if __name__ == "__main__":
    unittest.main()
