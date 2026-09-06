import tempfile
import unittest
from pathlib import Path
import sys
import json
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import export_public_records as subject


class ExportPublicRecordsTests(unittest.TestCase):
    def test_allowlist_and_sensitive_metadata(self):
        subject.validate_public({"sourceId": "wikibooks-chess", "image": "page.png"})
        with self.assertRaises(ValueError): subject.validate_public({"sourceId": "private-book"})
        with self.assertRaises(ValueError): subject.validate_public({"content": "book text"})

    def test_build_verify_and_restore_metadata_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "work" / "modern"; out = root / "records"; source.mkdir(parents=True)
            (source / "x.json").write_text('{"sourceId":"ctan-chessboard","records":[]}', encoding="utf-8")
            old = subject.FILES; subject.FILES = ("x.json",)
            try:
                index = subject.build_index(source, out)
                self.assertEqual(subject.verify_index(source, out)["files"], 1)
                restored = root / 'fresh' / "work" / "modern"; self.assertEqual(subject.restore(out, restored)["restored"], 1)
                self.assertEqual((restored / "x.json").read_bytes(), (source / "x.json").read_bytes())
                self.assertEqual(subject.verify_index(None, out)['files'], 1)
                (restored/'x.json').write_text('{}')
                with self.assertRaisesRegex(ValueError, 'restore conflict'):
                    subject.restore(out, restored)
            finally: subject.FILES = old

    def test_traversal_symlink_and_stale_snapshot_rejected(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(subject, 'FILES', ('x.json',)):
            root=Path(directory); source=root/'source';source.mkdir();out=root/'records'
            (source/'x.json').write_text('{"sourceId":"wikibooks-chess"}')
            subject.build_index(source,out)
            index=json.loads((out/'index.json').read_text()); index['records'][0]['original']='work/modern/../../../escape.json'
            (out/'index.json').write_text(json.dumps(index))
            with self.assertRaisesRegex(ValueError, 'mapping differs'):
                subject.restore(out,root/'fresh/work/modern')
            with self.assertRaises(ValueError): subject.safe(root, '../escape')
            link=root/'linked';link.symlink_to(source,target_is_directory=True)
            with self.assertRaises(ValueError): subject.safe(link,'x.json')
            index['records'][0]['original']='work/modern/x.json';(out/'index.json').write_text(json.dumps(index))
            (out/'x.json').write_text('{"sourceId":"ctan-mpchess"}')
            with self.assertRaises(ValueError): subject.verify_index(None,out)


if __name__ == "__main__": unittest.main()
