import copy
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]))
import assemble_feasibility as subject


def records():
    rows=[]
    for split,count,source in [('train',70,'wikibooks-chess'),('train',10,'historic-public-a'),('dev',20,'ctan-chessboard'),('held-out',20,'ctan-mpchess')]:
        for index in range(count):
            rows.append({'id':f'{source}-{index}','sourceId':source,'family':source,'split':split,'cropSha256':f'{source}-{index}','placement':'KQRBNPkq/rbnp4/8/8/8/8/8/8'})
    return rows


class AssemblyTests(unittest.TestCase):
    def test_rank_order_and_validation(self):
        actual=subject.labels('k7/8/8/8/8/8/8/R6K')
        self.assertEqual((actual[0],actual[7],actual[56]),(3,1,7))
        for invalid in ('8/8','9/8/8/8/8/8/8/8','7/8/8/8/8/8/8/8'):
            with self.assertRaises(ValueError): subject.labels(invalid)

    def test_position_audit_is_rotation_invariant(self):
        self.assertEqual(subject.position_key('k7/8/8/8/8/8/8/R6K'),subject.position_key('K6R/8/8/8/8/8/8/7k'))

    def test_count_class_component_gates_and_repeats(self):
        result=subject.audit_records(records())
        self.assertEqual(result['boards'],120)
        self.assertEqual(result['crossSplitRepeatedPositions'],1)
        self.assertFalse(result['qualified'])
        with self.assertRaises(ValueError): subject.audit_records(records()[:-1])
        rows=records(); rows[0]['family']='ctan-chessboard'
        with self.assertRaisesRegex(ValueError,'leakage'): subject.audit_records(rows)
        rows=records(); rows[1]['cropSha256']=rows[0]['cropSha256']
        with self.assertRaisesRegex(ValueError,'duplicate'): subject.audit_records(rows)

    def test_immutable_publication_and_path_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); artifact=root/'data.json'
            subject.publish(artifact,b'one'); subject.publish(artifact,b'one')
            with self.assertRaises(ValueError): subject.publish(artifact,b'two')
            for name in ('../escape','/absolute',''):
                with self.assertRaises(ValueError): subject.relative(root,name)
            (root/'link').symlink_to(root/'target')
            with self.assertRaises(ValueError): subject.relative(root,'link/data')


if __name__=='__main__': unittest.main()
