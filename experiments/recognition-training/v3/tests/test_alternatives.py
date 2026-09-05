from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from alternatives import (
    AlternativeError, CANONICAL_CLASSES, Detection, _normalized_to_letterbox, _undo_letterbox, associate_nakst_boards,
    canonicalize_fenify_output, decode_nakst, prepare_fenify_rgb,
    prepare_nakst_rgb,
    verify_artifact,
)


class AlternativeTests(unittest.TestCase):
    def test_artifact_identity_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model"
            path.write_bytes(b"model")
            with self.assertRaises(AlternativeError):
                verify_artifact(path, "0" * 64, 5)

    def test_fenify_preprocessing_is_nchw_grayscale_and_normalized(self) -> None:
        rgb = np.zeros((300, 300, 3), dtype=np.uint8)
        rgb[..., 0], rgb[..., 1], rgb[..., 2] = 255, 0, 0
        result = prepare_fenify_rgb(rgb)
        self.assertEqual(result.shape, (1, 3, 300, 300))
        self.assertEqual(result.dtype, np.float32)
        gray = 76 / 255
        np.testing.assert_allclose(result[0, :, 0, 0], (gray-np.array([.485,.456,.406]))/np.array([.229,.224,.225]), atol=1e-6)

    def test_fenify_asymmetric_corners_match_dataset_a1_first_contract(self) -> None:
        native = np.zeros((1, 64, 13), dtype=np.float32)
        native[:, :, 0] = 1
        native[0, 0] = 0; native[0, 0, 6] = 1
        native[0, 56] = 0; native[0, 56, 7] = 1
        canonical = canonicalize_fenify_output(native)
        self.assertEqual(canonical[0, 0, CANONICAL_CLASSES.index("K")], 1)
        self.assertEqual(canonical[0, 56, CANONICAL_CLASSES.index("p")], 1)

    def test_nakst_input_is_center_letterboxed(self) -> None:
        result, geometry = prepare_nakst_rgb(np.full((320, 640, 3), 255, np.uint8))
        self.assertEqual(result.shape, (1, 3, 640, 640))
        self.assertTrue(np.all(result[:, :, 160:480] == 1))
        self.assertAlmostEqual(float(result[0, 0, 0, 0]), 114/255)
        self.assertEqual(geometry, {"scale": 1, "left": 0, "top": 160, "resizedWidth": 640, "resizedHeight": 320})
        with self.assertRaises(AlternativeError):
            prepare_nakst_rgb(np.zeros((0, 640, 3), np.uint8))

    def test_nakst_decoder_threshold_and_class_aware_nms(self) -> None:
        output = np.zeros((1, 17, 8400), dtype=np.float32)
        output[0, :4, 0] = [320, 320, 400, 400]; output[0, 4, 0] = .9
        output[0, :4, 1] = [320, 320, 390, 390]; output[0, 4, 1] = .8
        output[0, :4, 2] = [320, 320, 40, 40]; output[0, 5, 2] = .85
        decoded = decode_nakst(output)
        self.assertEqual([item.class_id for item in decoded], [0, 1])
        self.assertAlmostEqual(decoded[0].score, .9, places=6)
        self.assertAlmostEqual(decoded[1].score, .85, places=6)

    def test_nakst_decoder_clips_only_tiny_sigmoid_drift(self) -> None:
        output = np.zeros((1, 17, 8400), dtype=np.float32)
        output[0, :4, 0] = [320, 320, 40, 40]
        output[0, 4, 0] = np.float32(1 + 1e-7)
        output[0, 5, 1] = np.float32(-1e-7)
        numeric = {}
        decoded = decode_nakst(output, numeric=numeric)
        self.assertEqual(decoded[0].score, 1)
        self.assertEqual(numeric["clippedScores"], 2)
        self.assertGreater(numeric["maximumPreClip"], 1)
        self.assertLess(numeric["minimumPreClip"], 0)

    def test_nakst_decoder_rejects_material_probability_violation(self) -> None:
        for value in (-0.001, 1.001):
            output = np.zeros((1, 17, 8400), dtype=np.float32)
            output[0, 4, 0] = value
            with self.assertRaises(AlternativeError):
                decode_nakst(output)

    def test_nakst_association_uses_predicted_board_and_exposes_no_empty_probability(self) -> None:
        detections = [
            Detection((0, 0, 640, 640), .9, 0),
            Detection((1, 1, 79, 79), .8, 1),
            Detection((700, 700, 720, 720), .99, 2),
        ]
        boards = associate_nakst_boards(detections)
        self.assertEqual(len(boards), 1)
        self.assertEqual(boards[0]["cellsA1First"][56]["label"], "K")
        self.assertAlmostEqual(boards[0]["cellsA1First"][56]["confidence"], .8)
        self.assertIsNone(boards[0]["cellsA1First"][0]["label"])
        self.assertFalse(boards[0]["emptyConfidenceAvailable"])
        self.assertFalse(boards[0]["orientationInferred"])

    def test_duplicate_piece_cell_abstains(self) -> None:
        boards = associate_nakst_boards([
            Detection((0, 0, 640, 640), .9, 0),
            Detection((1, 1, 30, 30), .8, 1),
            Detection((2, 2, 31, 31), .7, 2),
        ])
        self.assertTrue(boards[0]["abstained"])
        self.assertIsNone(boards[0]["cellsA1First"][56]["label"])

    def test_letterbox_boxes_return_to_original_page_coordinates(self) -> None:
        mapped = _undo_letterbox(
            Detection((100, 170, 300, 370), .8, 1),
            {"scale": 1, "left": 0, "top": 160}, 640, 320,
        )
        self.assertEqual(mapped.xyxy, (100, 10, 300, 210))

    def test_normalized_asymmetric_box_returns_to_original_page_coordinates(self) -> None:
        normalized = Detection((.25, .125, .75, .375), .8, 1)
        letterbox = _normalized_to_letterbox(normalized)
        self.assertEqual(letterbox.xyxy, (160, 80, 480, 240))
        mapped = _undo_letterbox(
            letterbox,
            {"scale": .5, "left": 0, "top": 160}, 1280, 640,
        )
        self.assertEqual(mapped.xyxy, (320, 0, 960, 160))


if __name__ == "__main__":
    unittest.main()
