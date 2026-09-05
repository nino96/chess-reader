import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from evaluate_onnx import EvaluationError, _freeze_candidate


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class V2FreezeBoundaryTests(unittest.TestCase):
    def _frozen_input(self, root: Path, candidates: list[dict]) -> tuple[Path, Path, Path]:
        data = root / 'data'
        runs = root / 'runs'
        data.mkdir()
        runs.mkdir()
        vectors = data / 'test.vectors.f32le'
        vectors.write_bytes(b'v2-held-out-vectors')
        boards = [{'id': f'opaque-{index}', 'labels': [0] * 64} for index in range(256)]
        (data / 'test.labels.json').write_text(
            json.dumps({'schemaVersion': 1, 'split': 'test', 'boards': boards}), encoding='utf-8'
        )
        wrapper = {
            'schemaVersion': 1, 'id': 'print-held-out-v2', 'role': 'held-out-test',
            'dtype': 'float32-le', 'shape': [256, 64, 1024],
            'byteLength': vectors.stat().st_size, 'sha256': digest(vectors),
            'labels': [{'boardId': board['id'], 'classes': board['labels']} for board in boards],
        }
        wrapper_path = data / 'vectors.manifest.json'
        wrapper_path.write_text(json.dumps(wrapper), encoding='utf-8')
        model = runs / 'candidate.onnx'
        model.write_bytes(b'candidate')
        for candidate in candidates:
            candidate['modelPath'] = 'candidate.onnx'
            candidate['sha256'] = digest(model)
            candidate['bytes'] = model.stat().st_size
        freeze = {
            'schemaVersion': 1, 'runKind': 'full', 'protocolSha256': 'p' * 64,
            'testManifestSha256': digest(wrapper_path), 'candidates': candidates,
        }
        freeze_path = runs / 'candidates.freeze.json'
        freeze_path.write_text(json.dumps(freeze), encoding='utf-8')
        return freeze_path, model, data

    def test_v2_held_out_inference_requires_both_predeclared_v2_seeds(self) -> None:
        candidates = [
            {'id': 'shipped', 'seed': None},
            {'id': 'tilenet-full-3811', 'seed': 3811},
            {'id': 'tilenet-full-3812', 'seed': 3812},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            freeze, model, data = self._frozen_input(Path(temporary), candidates)
            result = _freeze_candidate(freeze, model, 'p' * 64, data)
            self.assertEqual(result['id'], 'tilenet-full-3812')

    def test_v1_candidate_identity_cannot_open_the_v2_held_out_set(self) -> None:
        candidates = [
            {'id': 'shipped', 'seed': None},
            {'id': 'tilenet-full-3801', 'seed': 3801},
            {'id': 'tilenet-full-3812', 'seed': 3812},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            freeze, model, data = self._frozen_input(Path(temporary), candidates)
            with self.assertRaisesRegex(EvaluationError, 'exactly shipped'):
                _freeze_candidate(freeze, model, 'p' * 64, data)


if __name__ == '__main__':
    unittest.main()
