import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from io import BytesIO

from PIL import Image

import sys

sys.path.insert(0, str(Path(__file__).parents[1]))
import pilot  # noqa: E402


def record(**changes):
    value = {
        "split": "train",
        "exposed": False,
        "lineageStatus": "reviewed",
        "workGroup": "work-a",
        "editionGroup": "edition-a",
        "lineageGroup": "lineage-a",
        "imageSha256": "image-a",
        "positionGroup": "position-a",
        "sequenceGroup": "sequence-a",
    }
    value.update(changes)
    return value


def png_data():
    stream = BytesIO()
    Image.new("RGB", (64, 64), "white").save(stream, format="PNG", optimize=False)
    return stream.getvalue()


class PilotTests(unittest.TestCase):
    def test_placement_has_exactly_64_known_classes(self):
        cells = pilot.placement_cells("8/8/8/8/8/8/8/8")
        self.assertEqual(len(cells), 64)
        self.assertEqual(set(cells), {"."})
        cells = pilot.placement_cells("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")
        self.assertEqual(len(cells), 64)
        self.assertEqual(cells[0], "r")
        self.assertEqual(cells[-1], "R")
        for invalid in ("8/8/8", "9/8/8/8/8/8/8/8", "8/8/8/8/8/8/8/7X"):
            with self.assertRaises(ValueError):
                pilot.placement_cells(invalid)

    def test_geometry_and_orientation_requirements(self):
        self.assertEqual(pilot.validate_rect([0, 0, 8, 8], (8, 8)), (0, 0, 8, 8))
        for rect in ([-1, 0, 8, 8], [0, 0, 7, 8], [0, 0, 9, 8], [0, 0, 8.0, 8]):
            with self.assertRaises(ValueError):
                pilot.validate_rect(rect, (8, 8))

    def test_split_lineage_duplicates_and_exposure_fail_closed(self):
        pilot.validate_splits([record(split="train"), record(split="dev", workGroup="work-b", editionGroup="edition-b", lineageGroup="lineage-b", imageSha256="image-b", positionGroup="position-b", sequenceGroup="sequence-b")])
        cases = [
            [record(split="train"), record(split="dev", workGroup="work-a")],
            [record(split="train"), record(split="dev", imageSha256="image-a")],
            [record(split="dev", lineageStatus="unknown")],
            [record(split="qualification", exposed=True)],
        ]
        for rows in cases:
            with self.assertRaises(ValueError):
                pilot.validate_splits(rows)
        pilot.validate_splits([
            record(split="qualification", exposed=False, workGroup="work-q", editionGroup="edition-q", lineageGroup="lineage-q", imageSha256="image-q", positionGroup="position-q", sequenceGroup="sequence-q"),
            record(split="clean-regression", exposed=False, workGroup="work-q", editionGroup="edition-q", lineageGroup="lineage-q", imageSha256="image-q", positionGroup="position-q", sequenceGroup="sequence-q"),
        ])

    def test_publish_replay_and_nonoverwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "artifact.bin"
            payload = b"immutable"
            pilot.publish(path, payload)
            pilot.publish(path, payload)
            with self.assertRaises(ValueError):
                pilot.publish(path, b"changed")
            link = Path(directory) / "link.bin"
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                pilot.publish(link, payload)
            target = Path(directory) / "target-dir"
            target.mkdir()
            parent = Path(directory) / "parent-link"
            parent.symlink_to(target, target_is_directory=True)
            with self.assertRaises(ValueError):
                pilot.publish(parent / "nested.bin", payload)

    def test_review_hash_binding_and_quarantine(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / "crops").mkdir()
            (work / "decisions").mkdir()
            crop = work / "crops" / "board-a.png"
            crop_data = png_data()
            crop.write_bytes(crop_data)
            proposal = {"placement": "8/8/8/8/8/8/8/8", "proposal": {"method": "manual-visual"}, "orientation": "white-bottom"}
            row = {
                "id": "board-a",
                "kind": "board",
                "sourceId": "public-a",
                "placement": proposal["placement"],
                "proposal": proposal["proposal"],
                "orientation": proposal["orientation"],
                "page": 1,
                "rect": [0, 0, 64, 64],
                "cropSha256": hashlib.sha256(crop_data).hexdigest(),
                "proposalSha256": pilot.digest(pilot.json_bytes(proposal)),
            }
            (work / "manifest.json").write_bytes(pilot.json_bytes({"schema": 1, "records": [row]}))
            with patch.object(pilot, "WORK", work), patch.object(
                pilot, "catalog_and_lock", return_value=({"public-a": {}}, {})
            ):
                pilot.review("board-a", "reviewer-a", "quarantined")
                result = pilot.verify()
                self.assertEqual(result["quarantinedRegions"], 1)
                decision = json.loads((work / "decisions" / "board-a-reviewer-a.json").read_text())
                self.assertEqual(decision["cropSha256"], row["cropSha256"])
                self.assertEqual(decision["proposalSha256"], row["proposalSha256"])
                decision["proposalSha256"] = "0" * 64
                (work / "decisions" / "board-a-reviewer-a.json").write_bytes(pilot.json_bytes(decision))
                with self.assertRaises(ValueError):
                    pilot.verify()

    def test_review_rejects_unknown_orientation_and_stale_proposal(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / "crops").mkdir()
            crop = work / "crops" / "board-a.png"
            crop_data = png_data()
            crop.write_bytes(crop_data)
            proposal = {"method": "manual-visual"}
            row = {
                "id": "board-a",
                "kind": "board",
                "sourceId": "public-a",
                "placement": "8/8/8/8/8/8/8/8",
                "proposal": proposal,
                "orientation": "unknown",
                "page": 1,
                "rect": [0, 0, 64, 64],
                "cropSha256": hashlib.sha256(crop_data).hexdigest(),
                "proposalSha256": pilot.digest(pilot.json_bytes({"placement": "8/8/8/8/8/8/8/8", "proposal": proposal, "orientation": "unknown"})),
            }
            (work / "manifest.json").write_bytes(pilot.json_bytes({"schema": 1, "records": [row]}))
            with patch.object(pilot, "WORK", work), patch.object(
                pilot, "catalog_and_lock", return_value=({"public-a": {}}, {})
            ):
                with self.assertRaises(ValueError):
                    pilot.review("board-a", "reviewer-a", "accepted")
                row["orientation"] = "white-bottom"
                (work / "manifest.json").write_bytes(pilot.json_bytes({"schema": 1, "records": [row]}))
                with self.assertRaises(ValueError):
                    pilot.review("board-a", "reviewer-a", "accepted")

    def test_verify_rejects_forged_review_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / "crops").mkdir()
            (work / "decisions").mkdir()
            crop = work / "crops" / "board-a.png"
            crop_data = png_data()
            crop.write_bytes(crop_data)
            placement = "8/8/8/8/8/8/8/8"
            proposal = {"method": "manual-visual"}
            crop_hash = hashlib.sha256(crop_data).hexdigest()
            proposal_hash = pilot.digest(pilot.json_bytes({"placement": placement, "proposal": proposal, "orientation": "white-bottom"}))
            row = {"id": "board-a", "kind": "board", "sourceId": "public-a", "page": 1,
                   "rect": [0, 0, 64, 64], "placement": placement,
                   "proposal": proposal, "orientation": "white-bottom", "cropSha256": crop_hash,
                   "proposalSha256": proposal_hash}
            decision = {"schema": 1, "id": "board-a", "reviewer": "reviewer-a", "decision": "accepted",
                        "all64SquaresReviewed": False, "geometryReviewed": False,
                        "cropSha256": crop_hash, "proposalSha256": proposal_hash}
            (work / "manifest.json").write_bytes(pilot.json_bytes({"schema": 1, "records": [row]}))
            (work / "decisions" / "board-a-reviewer-a.json").write_bytes(pilot.json_bytes(decision))
            with patch.object(pilot, "WORK", work), patch.object(
                pilot, "catalog_and_lock", return_value=({"public-a": {}}, {})
            ):
                with self.assertRaises(ValueError):
                    pilot.verify()


if __name__ == "__main__":
    unittest.main()
