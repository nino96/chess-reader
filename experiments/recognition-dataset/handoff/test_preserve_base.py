import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preserve_base as base


class PreservationTests(unittest.TestCase):
    def test_checked_in_base_and_idempotent_restore(self):
        base.verify(base.SAVED)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'base'
            base.transfer(base.SAVED, target)
            base.transfer(base.SAVED, target)
            self.assertEqual(base.verify(target), base.verify(base.SAVED))

    def test_conflict_tamper_and_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'base'
            base.transfer(base.SAVED, target)
            (target / 'fenshot-recovered.pt').write_bytes(b'not the base')
            with self.assertRaises(ValueError):
                base.verify(target)
            with self.assertRaises(ValueError):
                base.transfer(base.SAVED, target)
            linked = Path(directory) / 'linked'
            linked.symlink_to(base.SAVED, target_is_directory=True)
            with self.assertRaises(ValueError):
                base.verify(linked)


if __name__ == '__main__':
    unittest.main()
