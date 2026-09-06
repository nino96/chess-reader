"""Make local, full-board proposal sheets without approving any labels."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw
from modern_extract import publish, _png


def sheets(proposals: Path, work: Path, prefix: str) -> None:
    data = json.loads(proposals.read_text())
    rows = data['records']
    for start in range(0, len(rows), 6):
        canvas = Image.new('RGB', (1200, 1500), 'white')
        draw = ImageDraw.Draw(canvas)
        for offset, row in enumerate(rows[start:start + 6]):
            sid = row.get('sourceId', data.get('sourceId'))
            with Image.open(work / 'pages' / f"{sid}-p{row['page']:04}.png") as page:
                x, y, w, h = row['rect']
                crop = page.crop((x, y, x+w, y+h)).convert('RGB')
            crop.thumbnail((390, 390))
            left, top = (offset % 3)*400, (offset // 3)*750
            canvas.paste(crop, (left, top+30))
            draw.text((left+5, top+5), row['id'], fill='black')
            for rank, placement in enumerate(row['placement'].split('/')):
                expanded = ''.join('.'*int(c) if c.isdigit() else c for c in placement)
                draw.text((left+20, top+430+rank*25), '  '.join(expanded), fill='black')
        publish(work / 'proposal-review' / f'{prefix}-{start//6:02}.png', _png(canvas))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('proposals', type=Path)
    parser.add_argument('--work', type=Path, default=Path(__file__).parent/'work/modern')
    parser.add_argument('--prefix', required=True)
    args = parser.parse_args()
    if not args.prefix.replace('-', '').isalnum(): raise ValueError('invalid prefix')
    sheets(args.proposals, args.work, args.prefix)
