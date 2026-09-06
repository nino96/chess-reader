"""Approve reviewed transform recipes separately, then pack train-only views."""
import argparse
from io import BytesIO
import json
from assemble_feasibility import ROOT, digest, encoded, labels, publish, read, relative
WORK=ROOT/'work/modern'
AUG=WORK/'augmentation-v3'


def approve():
    original=read(AUG/'manifest.json'); review=read(AUG/'fidelity-review.json')
    if review['manifestSha256']!=digest((AUG/'manifest.json').read_bytes()) or review['decision']!='accept-bounded-recipes': raise ValueError('fidelity decision changed')
    for name,expected in review['sheets'].items():
        if digest(relative(AUG,name).read_bytes())!=expected: raise ValueError('fidelity sheet changed')
    parents={r['id']:r for r in read(WORK/'manifest.json')['records'] if r['split']=='train'}
    for row in original['records']:
        parent=parents[row['parentId']]
        if row['placement']!=parent['placement'] or row['parentCropSha256']!=parent['cropSha256'] or row['split']!='train': raise ValueError('augmentation parent/label/split mismatch')
        if digest((AUG/'crops'/f"{row['id']}.png").read_bytes())!=row['cropSha256']: raise ValueError('augmentation crop changed')
        row['review']={'status':'accepted','all64':True,'geometry':True,'type':'inherited-reviewed-labels-and-bounded-transform','reviewer':'lead-visual-plus-independent-fidelity-audit','individualDerivativeHumanReview':False,'fidelityReviewSha256':digest((AUG/'fidelity-review.json').read_bytes())}
    original['role']='train-only-reviewed-transform-bank'; original['recipe']='real-print-v2'
    publish(AUG/'manifest-reviewed.json',encoded(original))
    return {'approvedDerivedViews':len(original['records']),'visualAuditParents':8,'independentNewBoards':0}


def pack():
    import numpy as np
    manifest=read(AUG/'manifest-reviewed.json'); pre=read(AUG/'preprocess-manifest.json')
    if pre['manifestSha256']!=digest((AUG/'manifest-reviewed.json').read_bytes()): raise ValueError('augmentation preprocessing differs')
    targets=read(WORK/'dataset/train.metadata.json')['boards']; derived={r['id']:r for r in manifest['records']}; proposals={r['id']:r for r in pre['records']}
    views=[]
    for parent in targets:
        group=[]
        for name in ('print-scan','alignment','combined'):
            rid=f"aug-{parent['id']}-{name}"; row=derived[rid]; tensor=proposals[rid]
            if row['parentId']!=parent['id'] or tensor['labels']!=labels(row['placement']): raise ValueError('augmentation label order differs')
            data=relative(AUG,tensor['tensor']['path']).read_bytes()
            if len(data)!=65536*4 or digest(data)!=tensor['tensor']['sha256']: raise ValueError('augmentation tensor changed')
            group.append(np.frombuffer(data,dtype='<f4').reshape(64,1024))
        views.append(group)
    values=np.asarray(views,dtype=np.float32)
    if values.shape!=(len(targets),3,64,1024): raise ValueError('invalid augmentation bank shape')
    stream=BytesIO();np.savez(stream,tiles=values);publish(AUG/'bank.npz',stream.getvalue())
    lock={'schema':1,'parentIds':[r['id'] for r in targets],'bankSha256':digest(stream.getvalue()),'trainTilesSha256':digest((WORK/'dataset/train.npz').read_bytes()),'manifestSha256':digest((AUG/'manifest-reviewed.json').read_bytes()),'preprocessSha256':digest((AUG/'preprocess-manifest.json').read_bytes()),'shape':list(values.shape)}
    publish(AUG/'bank-lock.json',encoded(lock));return {'parents':len(targets),'views':len(targets)*3,'bankSha256':lock['bankSha256']}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=('approve','pack'));args=parser.parse_args();print(json.dumps(approve() if args.command=='approve' else pack()))
