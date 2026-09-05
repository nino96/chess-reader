import unittest
from summarize import promotion

class PromotionTests(unittest.TestCase):
    def test_raw_exact_cannot_hide_low_confidence_or_reliable_wrong(self):
        rules = dict(minimumExactBoardAccuracy=.95, minimumSquareAccuracy=.995, maximumReliableWrong=0)
        regression = dict(reliableExact=8, correctSquares=880, reliableWrong=0)
        raw_perfect = dict(totalBoards=100, totalSquares=6400, reliableExact=94,
                           confidentCorrectSquares=6367, reliableWrong=1)
        result = promotion(raw_perfect, regression, regression, rules)
        self.assertFalse(result['heldOutReliableExact'])
        self.assertFalse(result['heldOutConfidentCorrectSquares'])
        self.assertFalse(result['heldOutZeroReliableWrong'])
        boundary = dict(totalBoards=100, totalSquares=6400, reliableExact=95,
                        confidentCorrectSquares=6368, reliableWrong=0)
        self.assertTrue(all(promotion(boundary, regression, regression, rules).values()))
        worse = dict(reliableExact=7, correctSquares=879, reliableWrong=1)
        result = promotion(boundary, worse, regression, rules)
        self.assertFalse(result['regressionReliableExact'])
        self.assertFalse(result['regressionCorrectSquares'])
        self.assertFalse(result['regressionReliableWrong'])
