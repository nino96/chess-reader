"""Regression for the first CUDA pilot's missing classifier forward call."""
from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from dataset import Dataset
from tilenet_model import TileNet
from trainer import _restore_rng, _rng_state, configure_determinism, recipe_from_protocol, train


class TrainingStepTests(unittest.TestCase):
    def test_cuda_rng_restore_passes_cpu_byte_states_to_cuda_api(self):
        with patch("trainer.torch.cuda.is_available", return_value=True), \
             patch("trainer.torch.cuda.get_rng_state_all", return_value=[torch.zeros(16, dtype=torch.uint8)]):
            state = _rng_state()
            def require_cpu_byte_states(states):
                self.assertTrue(all(value.device.type == "cpu" and value.dtype == torch.uint8
                                    for value in states))
            with patch("trainer.torch.cuda.set_rng_state_all", side_effect=require_cpu_byte_states) as restore:
                _restore_rng(state)
                restore.assert_called_once()

    def test_optimizer_step_changes_classifier_weights(self):
        protocol = json.loads((Path(__file__).parents[1] / "protocol.json").read_text())
        recipe = replace(recipe_from_protocol(protocol, "pilot", 38), train_boards=2,
                         dev_boards=1, epochs=1, batch_size=128)
        rng = np.random.default_rng(71)

        def data(split, count):
            return Dataset(split, rng.random((count, 64, 1024), dtype=np.float32),
                           rng.integers(0, 13, (count, 64)), "a" * 64, "b" * 64,
                           "c" * 64, "d" * 64, "e" * 64,
                           frozenset({split}), count)

        previous_threads = torch.get_num_threads()
        try:
            torch.set_num_threads(2)
            configure_determinism(38)
            initial = TileNet().conv1.weight.detach().clone()
            configure_determinism(38)
            with tempfile.TemporaryDirectory() as directory:
                result = train(recipe, data("train", 2), data("dev", 1),
                               torch.device("cpu"), Path(directory) / "checkpoint.pt", False)
            self.assertFalse(torch.equal(initial, result.model.conv1.weight.detach()))
            self.assertEqual(len(result.losses), 1)
            self.assertTrue(np.isfinite(result.losses[0]["trainMeanCrossEntropy"]))
        finally:
            torch.set_num_threads(previous_threads)
