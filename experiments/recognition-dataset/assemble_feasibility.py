"""Assemble reviewed public proposals, then pack exact FENShot tensors.

Review decisions are separate, hash-bound local inputs. This program never
infers approval from a recognizer, notation, legality, or proposal agreement.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
ORDER = '.KQRBNPkqrbnp'


def digest(data: bytes) -> str:
    return sha256(data).hexdigest()


def encoded(data: object) -> bytes:
    return (json.dumps(data, indent=2, sort_keys=True) + '\n').encode()


def read(path: Path) -> dict:
    if path.is_symlink() or path.stat().st_size > 16*1024*1024:
        raise ValueError('invalid JSON artifact')
    return json.loads(path.read_bytes())


def publish(path: Path, data: bytes) -> None:
    if path.is_symlink(): raise ValueError('symlink output')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data: raise ValueError('immutable output differs: '+path.name)
        return
    with path.open('xb') as stream: stream.write(data)


def relative(work: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or Path(name).is_absolute() or '..' in Path(name).parts:
        raise ValueError('invalid relative artifact path')
    path = work / name
    for ancestor in [path, *path.parents]:
        if ancestor.is_symlink(): raise ValueError('symlink artifact path')
    return path


def labels(placement: str) -> list[int]:
    ranks = placement.split('/')
    result = []
    if len(ranks) != 8: raise ValueError('invalid rank count')
    for rank in ranks:
        cells = []
        for char in rank:
            if char in '12345678': cells.extend([0]*int(char))
            elif char in ORDER[1:]: cells.append(ORDER.index(char))
            else: raise ValueError('invalid piece class')
        if len(cells) != 8: raise ValueError('invalid rank width')
        result.append(cells)
    return [cell for rank in reversed(result) for cell in rank]


def assemble(work: Path, decisions_path: Path) -> dict:
    from PIL import Image, ImageDraw
    from modern_extract import canonical_proposal, validate_catalog, validate_rect, _png
    sources = validate_catalog(read(ROOT/'modern-sources.json'))
    pages = {(p['sourceId'], p['page']): p for p in read(work/'pages.json')['pages']}
    decisions = read(decisions_path)
    output = []
    for decision in decisions['inputs']:
        path = relative(work, decision['proposal'])
        if digest(path.read_bytes()) != decision['sha256']: raise ValueError('review proposal changed')
        if decision.get('reviewer') != 'lead-visual' or not decision.get('evidence'):
            raise ValueError('explicit lead review missing')
        data = read(path)
        selected = set(decision['acceptedIds'])
        if len(selected) != len(decision['acceptedIds']): raise ValueError('duplicate review IDs')
        found = set()
        for original in data['records']:
            if original['id'] not in selected: continue
            found.add(original['id'])
            row = dict(original)
            for key in ('sourceId', 'family', 'split'):
                row.setdefault(key, data.get(key))
            if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,95}', row['id']): raise ValueError('invalid ID')
            labels(row['placement'])
            if row['kind'] != 'board' or row['orientation'] not in ('white-bottom','black-bottom'):
                raise ValueError('unsupported accepted region')
            sid = row['sourceId']
            if sid.startswith('historic-public-'):
                if row['split'] != 'train': raise ValueError('exposed historic boards must be train only')
                crop_bytes = relative(work, 'crops/'+row['id']+'.png').read_bytes()
                if digest(crop_bytes) != row['cropSha256']: raise ValueError('historic crop changed')
            else:
                source = sources[sid]
                if row['split'] == 'train' and (sid != 'wikibooks-chess' or not source['rights']['training'].startswith('approved')):
                    raise ValueError('training source not admitted by this slice')
                if not source['rights']['evaluation'].startswith('approved'): raise ValueError('evaluation rights unresolved')
                page = pages[(sid,row['page'])]
                page_bytes = relative(work, 'pages/'+page['image']).read_bytes()
                if digest(page_bytes) != page['sha256']: raise ValueError('page changed')
                with Image.open(BytesIO(page_bytes)) as image:
                    x,y,w,h = validate_rect(row['rect'], image.size)
                    crop = image.convert('RGB').crop((x,y,x+w,y+h))
                    crop_bytes = _png(crop)
                    margin = max(1,round(min(w,h)*0.05))
                    loose = image.convert('RGB').crop((max(0,x-margin),max(0,y-margin),min(image.width,x+w+margin),min(image.height,y+h+margin)))
                    publish(work/'loose'/f"{row['id']}.png", _png(loose))
                    grid = crop.copy(); draw = ImageDraw.Draw(grid)
                    for n in range(1,8):
                        draw.line((n*w/8,0,n*w/8,h), fill='red')
                        draw.line((0,n*h/8,w,n*h/8), fill='red')
                    publish(work/'grid-review'/f"{row['id']}.png",_png(grid))
                row.update(pageSha256=page['sha256'],sourceSha256=source['expectedSha256'],cropSha256=digest(crop_bytes))
                publish(work/'crops'/f"{row['id']}.png",crop_bytes)
            row['review'] = {'status':'accepted','type':'agent-assisted','reviewer':'lead-visual','all64':True,'geometry':True,'decisionSha256':digest(decisions_path.read_bytes()),'proposalInputSha256':decision['sha256'],'evidence':decision['evidence']}
            row['proposalSha256'] = digest(encoded(canonical_proposal(row)))
            row['review']['boundCropSha256'] = row['cropSha256']
            row['review']['boundProposalSha256'] = row['proposalSha256']
            output.append(row)
        if selected != found: raise ValueError('review names missing proposals')
    if len({r['id'] for r in output}) != len(output): raise ValueError('duplicate board ID')
    manifest = {'schema':2,'catalogSha256':digest((ROOT/'modern-sources.json').read_bytes()),'reviewSha256':digest(decisions_path.read_bytes()),'records':output}
    publish(work/'manifest.json',encoded(manifest))
    return {'boards':len(output),'splits':dict(Counter(r['split'] for r in output))}


def audit_records(rows: list[dict]) -> dict:
    groups = defaultdict(set); hashes = defaultdict(set); positions = defaultdict(set)
    counts = Counter(); classes = defaultdict(Counter); families = defaultdict(set)
    for row in rows:
        split = row['split']; counts[split] += 1
        component = 'historic-unresolved-typefoundry' if row['sourceId'].startswith('historic-') else row['sourceId']
        groups[component].add(split); groups[row['family']].add(split)
        families[split].add(component)
        hashes[row['cropSha256']].add(split)
        positions[position_key(row['placement'])].add(split)
        classes[split].update(labels(row['placement']))
    if any(len(s)>1 for s in groups.values()): raise ValueError('document/artwork leakage')
    if any(len(s)>1 for s in hashes.values()): raise ValueError('image leakage')
    if len(hashes) != len(rows): raise ValueError('exact duplicate boards inflate counts')
    if len(rows)<120 or counts['train']<60 or counts['dev']<20 or counts['held-out']<20:
        raise ValueError('predeclared feasibility board-count gate unmet')
    if len(set.union(*families.values()))<4 or len(families['train'])<2:
        raise ValueError('predeclared source-component gate unmet')
    for split in ('train','dev'):
        if any(classes[split][i]==0 for i in range(1,13)): raise ValueError('missing colored piece class')
    train_positions = {p for p,s in positions.items() if 'train' in s}
    sensitivity = [r['id'] for r in rows if r['split']=='dev' and position_key(r['placement']) not in train_positions]
    return {'boards':len(rows),'splitCounts':dict(counts),'componentsBySplit':{s:sorted(v) for s,v in families.items()},'classCounts':{s:{ORDER[k]:v for k,v in c.items()} for s,c in classes.items()},'crossSplitRepeatedPositions':sum(len(s)>1 for s in positions.values()),'uniqueOrientationNormalizedPlacements':len(positions),'positionDisjointDevIds':sensitivity,'familyConfidence':'provisional; not proven independent training lineage','qualified':False}


def position_key(placement: str) -> str:
    # Compare the SAME representation in both directions (image rotation 180).
    cells = labels(placement)
    return min(','.join(map(str,cells)), ','.join(map(str,reversed(cells))))


def pack(work: Path) -> dict:
    import numpy as np
    manifest = read(work/'manifest.json'); preprocessing = read(work/'preprocess-manifest.json')
    if preprocessing['manifestSha256'] != digest((work/'manifest.json').read_bytes()): raise ValueError('preprocessing manifest mismatch')
    rows = manifest['records']; audit = audit_records(rows)
    pre = {r['id']:r for r in preprocessing['records']}
    if set(pre) != {r['id'] for r in rows}: raise ValueError('tensor membership mismatch')
    lock = {'schema':1,'splits':{}}
    for split in ('train','dev','held-out'):
        selected = [r for r in rows if r['split']==split]; tensors=[]; targets=[]; metadata=[]
        for row in selected:
            tensor = pre[row['id']]; target = labels(row['placement'])
            if target != tensor['labels']: raise ValueError('preprocessing label order mismatch')
            data = relative(work,tensor['tensor']['path']).read_bytes()
            if digest(data)!=tensor['tensor']['sha256'] or len(data)!=65536*4: raise ValueError('tensor identity/shape mismatch')
            values = np.frombuffer(data,dtype='<f4').reshape(64,1024)
            if not np.isfinite(values).all() or np.any(values<0) or np.any(values>1): raise ValueError('invalid tensor values')
            tensors.append(values); targets.append(target)
            tags=set(row['tags']); occupied=sum(t!=0 for t in target)
            review = read(work/'review-decisions.json')
            condition = review.get('conditions',{}).get(row['id'], 'historic-scan' if row['sourceId'].startswith('historic-') else ('colored-flat-low-native-resolution' if row['sourceId']=='wikibooks-chess' else ('empty-background' if occupied==0 else 'printed-document')))
            metadata.append({'id':row['id'],'sourceId':row['sourceId'],'family':row['family'],'condition':condition,'clean':row['id'] in review.get('cleanIds',[]),'exposed':split=='train','density':'empty' if occupied==0 else ('sparse' if occupied<=8 else ('medium' if occupied<=24 else 'dense')),'occupied':occupied,'cropSha256':row['cropSha256'],'placementSha256':digest(row['placement'].encode()),'tags':row['tags']})
        arrays=BytesIO(); np.savez(arrays,tiles=np.asarray(tensors,dtype=np.float32),labels=np.asarray(targets,dtype=np.int64))
        directory = work/('reserved' if split=='held-out' else 'dataset')
        publish(directory/f'{split}.npz',arrays.getvalue()); publish(directory/f'{split}.metadata.json',encoded({'schema':1,'boards':metadata}))
        if split!='held-out': lock['splits'][split]={'tilesSha256':digest(arrays.getvalue()),'metadataSha256':digest(encoded({'schema':1,'boards':metadata}))}
    lock.update(manifestSha256=digest((work/'manifest.json').read_bytes()),preprocessManifestSha256=digest((work/'preprocess-manifest.json').read_bytes()),audit=audit)
    publish(work/'dataset/dataset-lock.json',encoded(lock)); publish(work/'coverage.json',encoded(audit))
    return audit


if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('command',choices=('assemble','pack')); parser.add_argument('--work',type=Path,default=ROOT/'work/modern'); args=parser.parse_args()
    print(json.dumps(assemble(args.work,args.work/'review-decisions.json') if args.command=='assemble' else pack(args.work),sort_keys=True))
