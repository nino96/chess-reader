"""Smoke decisions must not turn abstention or accepted errors into advancement."""
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from native_smoke import smoke_policy, iou

class SmokePolicyTests(unittest.TestCase):
    def test_all_abstained_does_not_advance(self):
        self.assertFalse(smoke_policy([True],[0.2],[])['passed'])

    def test_no_exact_positive_does_not_advance(self):
        self.assertFalse(smoke_policy([False],[0.99],[])['passed'])

    def test_accepted_negative_or_wrong_blocks_matching_threshold(self):
        result=smoke_policy([True,False],[0.91,0.85],[0.80])
        self.assertEqual(result['feasibleSmokeThresholds'],[0.9])
        self.assertFalse(result['finalConfidencePolicyFrozen'])

    def test_iou_does_not_credit_disjoint_or_zero_area_boxes(self):
        self.assertEqual(iou([0,0,1,1],[2,2,3,3]),0)
        self.assertEqual(iou([0,0,0,0],[0,0,0,0]),0)
        self.assertEqual(iou([0,0,4,4],[0,0,4,4]),1)
