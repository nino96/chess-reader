"""Propose Wikibooks boards from published PDF image placement, never model truth.

The per-glyph label map is explicitly visually reviewed locally. Rendered page
review remains required; embedded assets do not establish final ground truth.
"""
from pathlib import Path
import argparse
from collections import Counter
import json
import subprocess
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw
from pilot import publish, json_bytes, digest, png_bytes

ROOT = Path(__file__).resolve().parent
WORK = ROOT / 'work/modern'


def inspect():
    source = ROOT / 'cache/modern/wikibooks-chess.pdf'
    if (WORK / 'wikibooks-layout.xml').exists():
        raise ValueError('layout exists; preserve original extraction')
    assets = WORK / 'wikibooks-assets'
    assets.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(['pdftohtml', '-xml', '-hidden', '-stdout', '-f', '5', '-l', '70',
                             str(source), str(assets / 'asset')], capture_output=True, timeout=60, check=True)
    if len(result.stdout) > 16*1024*1024:
        raise ValueError('oversize PDF structure')
    publish(WORK / 'wikibooks-layout.xml', result.stdout)
    root = ET.fromstring(result.stdout)
    found = []
    tiles = {}
    for page in root.findall('page'):
        for image in page.findall('image'):
            path = Path(image.attrib['src'])
            if assets.resolve() not in path.resolve().parents:
                raise ValueError('untrusted image path')
            with Image.open(path) as pic:
                if pic.width != pic.height or not 20 <= pic.width <= 60:
                    continue
                sha = digest(pic.convert('RGB').tobytes())
                if sha not in tiles:
                    tiles[sha] = {'id': f'glyph-{len(tiles):03}', 'sha256': sha, 'image': str(path.relative_to(WORK))}
            found.append({'page': int(page.attrib['number']), 'pageWidth': int(page.attrib['width']),
                          'pageHeight': int(page.attrib['height']), 'glyph': tiles[sha]['id'],
                          **{k:int(image.attrib[k]) for k in ('top','left','width','height')}})
    items = list(tiles.values())
    for start in range(0,len(items),80):
        subset=items[start:start+80]
        sheet=Image.new('RGB',(1000,((len(subset)+9)//10)*105),'white'); draw=ImageDraw.Draw(sheet)
        for i,item in enumerate(subset):
            with Image.open(WORK/item['image']) as pic:
                pic=pic.convert('RGB').resize((70,70),Image.Resampling.NEAREST)
                x,y=(i%10)*100,(i//10)*105;sheet.paste(pic,(x,y));draw.text((x,y+73),item['id'],fill='black')
        publish(WORK/f'wikibooks-glyphs-{start//80}.png',png_bytes(sheet))
    publish(WORK/'wikibooks-embedded.json',json_bytes({'schema':1,'sourceSha256':digest(source.read_bytes()),'glyphs':items,'placements':found}))
    print(json.dumps({'glyphs':len(tiles),'tilePlacements':len(found)}))


def placement(cells):
    ranks=[]
    for i in range(0,64,8):
        rank='';empty=0
        for char in cells[i:i+8]:
            if char=='.':empty+=1
            else:
                rank+=(str(empty) if empty else '')+char;empty=0
        ranks.append(rank+(str(empty) if empty else ''))
    return '/'.join(ranks)


def propose():
    data=json.loads((WORK/'wikibooks-embedded.json').read_bytes())
    mapping=json.loads((WORK/'wikibooks-glyph-map.json').read_bytes())['labels']
    images=data['placements']; rows=[]; seen={}; duplicates=[];i=0
    while i+64<=len(images):
        group=images[i:i+64];first=group[0];page=first['page']
        # Only a complete 8x8 grid of equally spaced placed assets is proposed.
        valid=all(t['page']==page and t['width']==first['width'] and t['height']==first['height'] for t in group)
        dx=(group[7]['left']-first['left'])/7;dy=(group[56]['top']-first['top'])/7
        valid=valid and dx>first['width']*.9 and dy>first['height']*.9 and abs(dx-dy)<1
        valid=valid and all(abs(t['left']-(first['left']+(j%8)*dx))<1.5 and abs(t['top']-(first['top']+(j//8)*dy))<1.5 for j,t in enumerate(group))
        if not valid:i+=1;continue
        i+=64
        glyphs=[r['glyph'] for r in group]; cells=[mapping[g] for g in glyphs]
        key=tuple(glyphs)
        if key in seen:
            duplicates.append({'page':page,'sameGlyphGridAs':seen[key]});continue
        rid=f"wikibooks-p{page:03}-{len(rows):03}";seen[key]=rid
        with Image.open(WORK/f'pages/wikibooks-chess-p{page:04}.png') as rendered:
            sx=rendered.width/first['pageWidth'];sy=rendered.height/first['pageHeight']
            # Include the thin inter-cell rules, with borders centered on cell boundaries.
            x=round((first['left']-(dx-first['width'])/2)*sx); y=round((first['top']-(dy-first['height'])/2)*sy)
            w=round(dx*8*sx);h=round(dy*8*sy)
            crop=rendered.crop((x,y,x+w,y+h)).convert('RGB')
            publish(WORK/f'proposed-wikibooks/{rid}.png',png_bytes(crop))
        rows.append({'id':rid,'sourceId':'wikibooks-chess','page':page,'rect':[x,y,w,h],
                     'placement':placement(cells),'orientation':'white-bottom','kind':'board','family':'wikibooks-xboard','split':'train',
                     'tags':['external-document','flat','colored-board','low-resolution-original', 'annotated' if any(g in ('glyph-004','glyph-006') for g in glyphs) else 'unmarked'],
                     'proposal':{'method':'pdf-asset-placement','glyphMapSha256':digest((WORK/'wikibooks-glyph-map.json').read_bytes()),'layoutSha256':digest((WORK/'wikibooks-layout.xml').read_bytes()),'evidence':'64 published image placements plus visually mapped original glyphs; rendered board review still required'},
                     'review':{'status':'proposed','type':'agent-assisted','all64':False,'geometry':False}})
    for start in range(0,len(rows),8):
        subset=rows[start:start+8];sheet=Image.new('RGB',(1600,((len(subset)+3)//4)*470),'white');draw=ImageDraw.Draw(sheet)
        for j,row in enumerate(subset):
            with Image.open(WORK/f"proposed-wikibooks/{row['id']}.png") as crop:
                crop.thumbnail((390,390));x,y=(j%4)*400,(j//4)*470;sheet.paste(crop,(x,y));draw.text((x,y+392),row['id'],fill='black')
                ranks=row['placement'].split('/');draw.text((x,y+409),' / '.join(ranks[:4]),fill='black');draw.text((x,y+425),' / '.join(ranks[4:]),fill='black')
        publish(WORK/f'wikibooks-boards-{start//8:02}.png',png_bytes(sheet))
    publish(WORK/'proposals-wikibooks.json',json_bytes({'schema':1,'records':rows,'duplicates':duplicates}))
    print(json.dumps({'proposedBoards':len(rows),'duplicateGlyphGrids':len(duplicates),'classCounts':dict(Counter(c for row in rows for c in row['placement'] if c.isalpha()))}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['inspect','propose']);args=parser.parse_args()
    inspect() if args.command=='inspect' else propose()
