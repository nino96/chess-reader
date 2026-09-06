"""Pre-inference data integrity, replay, coverage and historical separation audit."""
from __future__ import annotations
import hashlib
import json
from collections import Counter
from pathlib import Path
import subprocess
import sys
import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from dataset import load_split, validate_family_partitions  # noqa: E402

def digest(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def verify() -> dict:
    data=ROOT/'data/full'
    manifest=json.loads((data/'dataset-manifest.json').read_text())
    replay=ROOT/'data/replay'
    if (data/'dataset-manifest.json').read_bytes() != (replay/'dataset-manifest.json').read_bytes():
        raise ValueError('Independent regeneration manifest differs')
    validate_family_partitions(data)
    historical=json.loads((ROOT.parent/'manifests/samples-v1.json').read_text())
    old_hashes={sample['vectorSha256'] for split in historical['splits'].values() for sample in split['samples']}
    old_labels=set()
    for role in ('train','dev','test'):
        # Old synthetic labels only, for exact-identity exclusion. No inference or score use.
        document=json.loads((ROOT.parent/f'data/full/{role}.labels.json').read_text())
        old_labels.update(tuple(board['labels']) for board in document['boards'])
    seen_hashes=set(); seen_positions=set(); splits={}; strata=[]
    for role in ('train','dev','test'):
        loaded=load_split(data,role)
        artifact=manifest['artifacts'][role]
        for kind in ('vectors','labels'):
            name=artifact[kind]['path']
            if digest(data/name)!=digest(replay/name): raise ValueError('Replay artifact differs')
        document=json.loads((data/artifact['labels']['path']).read_text())
        classes=Counter(); coverage=Counter(); textures=Counter(); reductions=Counter(); speckles=0
        for i,board in enumerate(document['boards']):
            vector_hash=hashlib.sha256(loaded.vectors[i].tobytes()).hexdigest()
            position=tuple(board['labels'])
            if vector_hash in old_hashes or vector_hash in seen_hashes: raise ValueError('Duplicate/historical vector')
            if position in old_labels or position in seen_positions: raise ValueError('Duplicate/historical placement')
            seen_hashes.add(vector_hash);seen_positions.add(position);classes.update(position)
            render=board['render']; style=render['style']; reduction=render['reduction']; noisy=render['speckles']>0
            if style not in ('flat','hatch','halftone') or reduction not in (1,.82,.64): raise ValueError('Undeclared degradation')
            coverage[(board['family'],style,reduction,noisy)]+=1
            textures[style]+=1;reductions[str(reduction)]+=1;speckles+=noisy
            strata.append({'boardId':board['id'],'role':role,'family':board['family'],'style':style,'reduction':reduction,'speckled':noisy,'vectorSha256':vector_hash})
        if set(classes)!=set(range(13)):raise ValueError('Class missing')
        if [classes[i] for i in range(13)] != artifact['classDistribution']:raise ValueError('Class distribution inconsistent')
        if dict(textures)!=artifact['renderDistribution']['style'] or dict(reductions)!=artifact['renderDistribution']['reduction'] or speckles!=artifact['renderDistribution']['speckledBoards']:
            raise ValueError('Render distribution inconsistent')
        for family in loaded.families:
            for style in ('flat','hatch','halftone'):
                for reduction in (1,.82,.64):
                    for noisy in (False,True):
                        if coverage[(family,style,reduction,noisy)]==0:raise ValueError('Missing family/degradation combination')
        if not np.isfinite(loaded.vectors).all() or loaded.vectors.min()<0 or loaded.vectors.max()>1:raise ValueError('Invalid pixels')
        splits[role]={'boards':loaded.board_count,'classes':[classes[i] for i in range(13)],'textures':dict(textures),'reductions':dict(reductions),'speckledBoards':speckles,'crossTab':[{'family':k[0],'style':k[1],'reduction':k[2],'speckled':k[3],'boards':n} for k,n in sorted(coverage.items())]}
    for name,expected in manifest['generatorDependencies'].items():
        file=(ROOT/name) if not name.startswith(('packages/','pnpm-lock')) else ROOT.parents[2]/name
        if digest(file)!=expected:raise ValueError('Generator dependency changed')
    if digest(ROOT/manifest['generator']['path'])!=manifest['generator']['sha256']:raise ValueError('Generator changed')
    report={'schemaVersion':1,'status':'passed','command':'../.venv/bin/python verify_quality.py','commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'datasetManifestSha256':digest(data/'dataset-manifest.json'),'protocolSha256':digest(ROOT/'protocol.json'),'checks':{'exactReplay':True,'splitDisjointness':True,'historicalSyntheticExclusion':True,'allClasses':True,'allDegradationCombinations':True,'distributionRecount':True,'finitePixelRange':True,'generatorHashes':True},'splits':splits,'scriptSha256':digest(Path(__file__))}
    (ROOT/'runs').mkdir(exist_ok=True)
    (ROOT/'runs/automated-quality.json').write_text(json.dumps(report,indent=2)+'\n')
    (ROOT/'runs/strata.json').write_text(json.dumps({'schemaVersion':1,'datasetManifestSha256':report['datasetManifestSha256'],'boards':strata},indent=2)+'\n')
    return report
if __name__=='__main__':
    result=verify();print(json.dumps({'status':result['status'],'checks':result['checks']}))
