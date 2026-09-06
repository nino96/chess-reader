import hashlib, tempfile, unittest
from pathlib import Path
from PIL import Image
import sys
sys.path.insert(0, str(Path(__file__).parents[1]))
import degrade_real

class DegradeRealTests(unittest.TestCase):
    def test_variant_is_deterministic_and_bounded(self):
        image=Image.new("RGB",(128,128),"white")
        for name in degrade_real.VARIANTS:
            a=degrade_real.png(degrade_real.variant(image,"parent",name)[0]); b=degrade_real.png(degrade_real.variant(image,"parent",name)[0])
            self.assertEqual(hashlib.sha256(a).digest(),hashlib.sha256(b).digest()); self.assertEqual(Image.open(__import__('io').BytesIO(a)).size,(128,128))

    def test_publish_replay_and_nonoverwrite(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"a"/"x"; degrade_real.publish(p,b"a"); degrade_real.publish(p,b"a")
            with self.assertRaises(ValueError): degrade_real.publish(p,b"b")

if __name__ == "__main__": unittest.main()
