from __future__ import annotations

import unittest

import torch

from tilenet_model import CLASS_COUNT, ExportNet, TileNet, parameter_count


class TileNetContractTest(unittest.TestCase):
    def test_frozen_parameter_and_tensor_contract(self) -> None:
        model = TileNet().eval()
        self.assertEqual(parameter_count(model), 321_805)
        values = torch.zeros((3, 1024), dtype=torch.float32)
        logits = model(values)
        self.assertEqual(tuple(logits.shape), (3, CLASS_COUNT))
        probabilities = ExportNet(model)(values)
        self.assertTrue(torch.allclose(probabilities.sum(dim=1), torch.ones(3)))
