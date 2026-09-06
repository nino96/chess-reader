"""Freeze/verify actual public data, source grouping and code before training."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import subprocess
from assemble_feasibility import ROOT, audit_records, digest, encoded, labels, publish, read, relative

REPO=ROOT.parent.parent
WORK=ROOT/'work/modern'
LOCK=WORK/'pretraining-lock.json'


def freeze():
    catalog=read(ROOT/'modern-sources.json')
    sources={s['id']:s for s in catalog['sources']}
    manifest=read(WORK/'manifest.json'); pre=read(WORK/'preprocess-manifest.json')
    if audit_records(manifest['records']) != read(WORK/'coverage.json'): raise ValueError('coverage audit changed')
    if manifest['catalogSha256']!=digest((ROOT/'modern-sources.json').read_bytes()): raise ValueError('source catalog changed since assembly')
    for key,path in [('extractorSha256',REPO/'packages/test-fixtures/node_modules/@scoriiu/fenshot/dist/tiles.js'),('wrapperSha256',ROOT/'modern-preprocess.mjs'),('coreSha256',ROOT/'preprocess-core.mjs')]:
        if pre[key]!=digest(path.read_bytes()): raise ValueError('preprocessing implementation changed')
    if pre['manifestSha256']!=digest((WORK/'manifest.json').read_bytes()): raise ValueError('stale preprocessing')
    relations=defaultdict(set)
    for row in manifest['records']:
        review=row['review']
        if review['boundCropSha256']!=row['cropSha256'] or review['boundProposalSha256']!=row['proposalSha256']:
            raise ValueError('review binding changed')
        if digest((WORK/'crops'/f"{row['id']}.png").read_bytes())!=row['cropSha256']: raise ValueError('crop changed')
        if row['sourceId'] in sources:
            source=sources[row['sourceId']]
            for field in ('workGroup','editionGroup','lineageGroup'):
                if not source.get(field): raise ValueError('source relationship missing')
                relations[(field,source[field])].add(row['split'])
            if digest((ROOT/'cache/modern'/source['filename']).read_bytes())!=source['expectedSha256']:
                raise ValueError('source bytes changed')
            if digest((ROOT/'work/modern-intake'/source['rightsFilename']).read_bytes())!=source['expectedRightsSha256']:
                raise ValueError('rights bytes changed')
    if any(len(s)>1 for s in relations.values()): raise ValueError('related editions or artwork cross splits')
    if not any(r['split']=='train' and r['sourceId']=='wikibooks-chess' and sum(x!=0 for x in labels(r['placement']))>24 for r in manifest['records']):
        raise ValueError('modern dense real training coverage missing')
    aug=WORK/'augmentation-v3'; aug_pre=read(aug/'preprocess-manifest.json'); bank=read(aug/'bank-lock.json')
    for key in ('extractorSha256','wrapperSha256','coreSha256'):
        if aug_pre[key]!=pre[key]: raise ValueError('augmentation preprocessing implementation differs')
    for key,path in [('bankSha256',aug/'bank.npz'),('trainTilesSha256',WORK/'dataset/train.npz'),('manifestSha256',aug/'manifest-reviewed.json'),('preprocessSha256',aug/'preprocess-manifest.json')]:
        if bank[key]!=digest(path.read_bytes()): raise ValueError('augmentation bank binding changed')
    files=[ROOT/'feasibility-protocol.json',ROOT/'modern-sources.json',ROOT/'modern-pages.json',WORK/'manifest.json',WORK/'review-decisions.json',WORK/'preprocess-manifest.json',WORK/'coverage.json']
    files += list(ROOT.glob('*.py'))+list(ROOT.glob('*.mjs'))
    files += list((WORK/'dataset').glob('*'))+list((WORK/'reserved').glob('*'))
    files += list((WORK/'base').glob('*'))
    files += [WORK/'augmentation-v3'/name for name in ('manifest-reviewed.json','fidelity-review.json','preprocess-manifest.json','bank.npz','bank-lock.json')]
    files += [REPO/'experiments/recognition-training/v3/trainer.py',REPO/'experiments/recognition-training/planning/reconstruct_parity.py',REPO/'experiments/recognition-training/v3/diagnostic.py',REPO/'packages/test-fixtures/node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx',REPO/'packages/test-fixtures/node_modules/@scoriiu/fenshot/dist/tiles.js']
    if any(not p.is_file() for p in files): raise ValueError('required freeze input missing')
    result={'schema':1,'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'dirtyResearchTree':True,'files':{str(p.relative_to(REPO)):digest(p.read_bytes()) for p in sorted(set(files))},'heldOutScored':False,'humanCertified':False,'scope':'source-held-out feasibility, not production qualification'}
    publish(LOCK,encoded(result))
    return {'frozenFiles':len(result['files']),'lockSha256':digest(LOCK.read_bytes())}


def verify():
    data=read(LOCK)
    for name,expected in data['files'].items():
        path=REPO/name
        if not path.is_file() or digest(path.read_bytes())!=expected: raise ValueError('frozen input changed: '+name)
    return {'verifiedFiles':len(data['files']),'lockSha256':digest(LOCK.read_bytes())}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=('freeze','verify'));args=parser.parse_args()
    print(json.dumps(freeze() if args.command=='freeze' else verify(),sort_keys=True))
