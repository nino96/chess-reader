import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from trainer import TrainingError, _verify_data_quality


class DataQualityBoundaryTests(unittest.TestCase):
    def _write_quality(self, directory: Path, *, passed: bool = True, dataset: str = 'd' * 64) -> tuple[Path, Path]:
        reports = directory / 'reports'
        reports.mkdir(exist_ok=True)
        fidelity = reports / 'svg-fidelity.json'
        fidelity.write_text(json.dumps({'status': 'passed' if passed else 'failed'}), encoding='utf-8')
        automated = reports / 'automated-quality.json'
        automated.write_text(json.dumps({
            'status': 'passed', 'datasetManifestSha256': dataset, 'protocolSha256': 'p' * 64,
        }), encoding='utf-8')
        visual = directory / 'runs' / 'visual-review' / 'contact-sheet.png'
        visual.parent.mkdir(parents=True, exist_ok=True)
        visual.write_bytes(b'reviewed visual evidence')
        manifests = directory / 'manifests'
        manifests.mkdir(exist_ok=True)
        quality = manifests / 'data-quality.json'
        quality.write_text(json.dumps({
            'schemaVersion': 1,
            'status': 'passed',
            'datasetManifestSha256': dataset,
            'protocolSha256': 'p' * 64,
            'svgFidelitySha256': hashlib.sha256(fidelity.read_bytes()).hexdigest(),
            'automatedQualitySha256': hashlib.sha256(automated.read_bytes()).hexdigest(),
            'checks': {'allGlyphs': True, 'visualReview': True},
            'visualReview': {
                'status': 'passed', 'reviewer': 'lead',
                'artifactSha256': {
                    'runs/visual-review/contact-sheet.png': hashlib.sha256(visual.read_bytes()).hexdigest(),
                },
            },
        }), encoding='utf-8')
        return quality, fidelity

    def test_requires_passing_evidence_bound_to_the_v2_dataset_and_protocol(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            quality, fidelity = self._write_quality(Path(temporary))
            self.assertEqual(
                _verify_data_quality(Path(temporary), 'p' * 64, 'd' * 64, quality, fidelity, Path(temporary)),
                hashlib.sha256(quality.read_bytes()).hexdigest(),
            )
            with self.assertRaisesRegex(TrainingError, 'does not bind this dataset'):
                _verify_data_quality(Path(temporary), 'p' * 64, 'e' * 64, quality, fidelity, Path(temporary))

    def test_rejects_failed_or_substituted_svg_evidence_before_data_loading(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            quality, fidelity = self._write_quality(Path(temporary), passed=False)
            with self.assertRaisesRegex(TrainingError, 'not the reviewed passing artifact'):
                _verify_data_quality(Path(temporary), 'p' * 64, 'd' * 64, quality, fidelity, Path(temporary))
            quality, fidelity = self._write_quality(Path(temporary), passed=True)
            fidelity.write_text(json.dumps({'status': 'passed', 'changed': True}), encoding='utf-8')
            with self.assertRaisesRegex(TrainingError, 'not the reviewed passing artifact'):
                _verify_data_quality(Path(temporary), 'p' * 64, 'd' * 64, quality, fidelity, Path(temporary))

    def test_rejects_tampered_automated_or_visual_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            quality, fidelity = self._write_quality(root)
            (root / 'reports' / 'automated-quality.json').write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(TrainingError, 'automated quality evidence'):
                _verify_data_quality(root, 'p' * 64, 'd' * 64, quality, fidelity, root)
            quality, fidelity = self._write_quality(root)
            (root / 'runs' / 'visual-review' / 'contact-sheet.png').write_bytes(b'tampered')
            with self.assertRaisesRegex(TrainingError, 'visual review artifact differs'):
                _verify_data_quality(root, 'p' * 64, 'd' * 64, quality, fidelity, root)


if __name__ == '__main__':
    unittest.main()
