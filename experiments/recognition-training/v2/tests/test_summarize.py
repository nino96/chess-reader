from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
from summarize import stratified_test_metrics


class StratifiedSummaryTests(unittest.TestCase):
    def test_texture_reduction_and_speckle_are_all_reported_from_opaque_board_ids(self) -> None:
        metadata = {
            'opaque-a': {'style': 'hatch', 'reduction': .64, 'speckles': 1},
            'opaque-b': {'style': 'flat', 'reduction': 1, 'speckles': 0},
        }
        report = {'observations': [
            {'boardId': 'opaque-a', 'exact': False, 'correctSquares': 60, 'reliable': True, 'reliableWrong': True},
            {'boardId': 'opaque-b', 'exact': True, 'correctSquares': 64, 'reliable': True, 'reliableWrong': False},
        ]}
        result = stratified_test_metrics(report, metadata)
        self.assertEqual(result['texture']['hatch']['reliableWrongBoards'], 1)
        self.assertEqual(result['reduction']['0.64']['rawSquareAccuracy'], 60 / 64)
        self.assertEqual(result['speckle']['present']['lowConfidenceBoards'], 0)
        self.assertIsNone(result['texture']['flat']['confidentSquareAccuracy'])

    def test_unknown_or_duplicate_opaque_identity_is_rejected(self) -> None:
        metadata = {'opaque-a': {'style': 'hatch', 'reduction': .64, 'speckles': 1}}
        report = {'observations': [
            {'boardId': 'unknown', 'exact': False, 'correctSquares': 60, 'reliable': False, 'reliableWrong': False},
        ]}
        with self.assertRaisesRegex(ValueError, 'opaque v2 board identity'):
            stratified_test_metrics(report, metadata)


if __name__ == '__main__':
    unittest.main()
