"""Verify original experiment and product inputs without rewriting historical bytes."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT=Path(__file__).resolve().parents[3]
BASE='9240d93d91487dcaedbff5f7108479a342dcd8d6'
scopes=['experiments/recognition-training','apps/web','packages/test-fixtures','docs/eval-baselines','pnpm-lock.yaml']
names=subprocess.check_output(['git','ls-tree','-r','--name-only',BASE,'--',*scopes],cwd=ROOT,text=True).splitlines()
rows=[]
for name in names:
    expected=subprocess.check_output(['git','show',f'{BASE}:{name}'],cwd=ROOT)
    actual=(ROOT/name).read_bytes()
    if expected!=actual:raise ValueError(f'Protected historical bytes changed: {name}')
    rows.append({'path':name,'sha256':hashlib.sha256(actual).hexdigest()})
# Local frozen data/weights are also checked against their retained canonical hashes.
experiment=ROOT/'experiments/recognition-training'
manifest=json.loads((experiment/'manifests/dataset-v1.json').read_text())
for split in ('train','dev','test'):
    for record in manifest['artifacts'][split].values():
        if not isinstance(record,dict) or 'path' not in record:continue
        path=experiment/'data/full'/record['path']
        h=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
        if h.hexdigest()!=record['sha256']:raise ValueError('Historical synthetic data changed')
for seed in (3801,3802):
    report=json.loads((experiment/f'reports/full-{seed}.json').read_text())
    for filename,expected in [('candidate.onnx',report['model']['sha256']),('checkpoint.pt',report['checkpoint']['sha256'])]:
        if hashlib.sha256((experiment/f'runs/full-{seed}'/filename).read_bytes()).hexdigest()!=expected:raise ValueError('Historical candidate changed')
report={'schemaVersion':1,'status':'passed','command':'python3 experiments/recognition-training/v2/verify_preservation.py','baseCommit':BASE,'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'protectedFiles':len(rows),'inventorySha256':hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest(),'historicalSyntheticData':'byte-identical','historicalFullCandidates':'byte-identical','productionCodeFixturesBaselinesLock':'byte-identical'}
(experiment/'v2/runs/preservation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
