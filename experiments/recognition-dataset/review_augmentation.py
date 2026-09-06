"""Local stratified visual audit sheets for already generated train variants."""
import json
from pathlib import Path
from PIL import Image, ImageDraw
from assemble_feasibility import ROOT, labels, publish
from degrade_real import png, VARIANTS
WORK=ROOT/'work/modern'


def main():
    rows=json.loads((WORK/'manifest.json').read_text())['records']
    wiki=[r for r in rows if r['sourceId']=='wikibooks-chess']
    chosen=[]
    for lower,upper in [(25,64),(9,24),(1,8)]:
        chosen.extend([r for r in wiki if lower<=sum(x!=0 for x in labels(r['placement']))<=upper][:2])
    for source in ('historic-public-a','historic-public-b'):
        chosen.append(next(r for r in rows if r['sourceId']==source))
    for batch in range(2):
        sheet=Image.new('RGB',(1280,1440),'white'); draw=ImageDraw.Draw(sheet)
        for offset,row in enumerate(chosen[batch*4:batch*4+4]):
            paths=[WORK/'crops'/f"{row['id']}.png"]+[WORK/'augmentation-v3/crops'/f"aug-{row['id']}-{name}.png" for name in VARIANTS]
            for column,path in enumerate(paths):
                with Image.open(path) as image:
                    image=image.convert('RGB');image.thumbnail((312,312));sheet.paste(image,(column*320,offset*360+25))
                draw.text((column*320+3,offset*360+4),row['id'] if column==0 else VARIANTS[column-1],fill='black')
        publish(WORK/'augmentation-v3'/f'fidelity-{batch}.png',png(sheet))
    print(json.dumps({'reviewedParentCandidates':[r['id'] for r in chosen]}))


if __name__=='__main__':main()
