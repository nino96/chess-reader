"""Deterministic, bounded print/scan variants for accepted real training boards."""
from __future__ import annotations
import argparse, hashlib, json, os, tempfile, time, random
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work" / "modern"
MAX_SECONDS = 120
MAX_BYTES = 512 * 1024 * 1024
VARIANTS = ("print-scan", "alignment", "combined")

def digest(data: bytes) -> str: return hashlib.sha256(data).hexdigest()
def json_bytes(v: object) -> bytes: return (json.dumps(v, indent=2, sort_keys=True) + "\n").encode()

def publish(path: Path, data: bytes) -> None:
    if path.is_symlink() or any(p.is_symlink() for p in path.parents): raise ValueError("symlink output rejected")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data: raise ValueError("existing artifact differs")
        return
    fd, tmp = tempfile.mkstemp(prefix=".augment-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f: f.write(data); f.flush(); os.fsync(f.fileno())
        os.link(tmp, path)
    finally: os.unlink(tmp)

def seed_for(parent: str, variant: str) -> int:
    return int.from_bytes(hashlib.sha256(f"{parent}:{variant}:real-print-v1".encode()).digest()[:8], "big")

def png(image: Image.Image) -> bytes:
    out = BytesIO(); image.save(out, "PNG", optimize=False); return out.getvalue()

def jpeg_roundtrip(image: Image.Image, quality: int) -> Image.Image:
    out = BytesIO(); image.save(out, "JPEG", quality=quality, optimize=False, subsampling=0); out.seek(0)
    with Image.open(out) as decoded: return decoded.convert("RGB")

def alignment(image: Image.Image, seed: int) -> tuple[Image.Image, dict]:
    rng=random.Random(seed); angle=-0.35 if rng.random()<0.5 else 0.35; dx=rng.choice((-2,-1,0,1,2)); dy=rng.choice((-2,-1,0,1,2))
    rotated=image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=False, fillcolor="white")
    # A small projective shear: corner displacement is below .04 tile.
    g=(rng.random()*2-1)*0.0015/max(1,image.width); h=(rng.random()*2-1)*0.0015/max(1,image.height)
    out=rotated.transform(rotated.size, Image.Transform.PERSPECTIVE, (1,0,-dx,0,1,-dy,g,h,1), Image.Resampling.BICUBIC, fillcolor="white")
    return out,{"angleDegrees":angle,"shiftPixels":[dx,dy],"perspective":[g,h],"maxDisplacementTile":0.12}

def variant(image: Image.Image, parent: str, name: str) -> tuple[Image.Image, dict]:
    """Small bounded changes; no crop can move a glyph to another square."""
    seed = seed_for(parent, name); width, height = image.size
    if name == "print-scan":
        rng=random.Random(seed); scale=0.60+rng.random()*0.20
        reduced=image.resize((max(8,round(width*scale)),max(8,round(height*scale))),Image.Resampling.BOX)
        restored=reduced.resize(image.size,Image.Resampling.BILINEAR)
        sigma=0.35+rng.random()*0.30; contrast=0.94+rng.random()*0.06
        return ImageEnhance.Contrast(restored.filter(ImageFilter.GaussianBlur(sigma))).enhance(contrast),{"scale":scale,"blurSigma":sigma,"contrast":contrast}
    if name == "alignment":
        return alignment(image,seed)
    aligned, params=alignment(image,seed); rng=random.Random(seed ^ 0xA5A5)
    sigma=0.35+rng.random()*0.30; quality=75+rng.randrange(14); contrast=0.93+rng.random()*0.06
    out=ImageEnhance.Contrast(jpeg_roundtrip(aligned.filter(ImageFilter.GaussianBlur(sigma)),quality)).enhance(contrast)
    pix=list(out.getdata()); noisy=[]
    for r,g,b in pix:
        n=rng.randint(-3,3); noisy.append((max(0,min(255,r+n)),max(0,min(255,g+n)),max(0,min(255,b+n))))
    out.putdata(noisy); params.update({"blurSigma":sigma,"jpegQuality":quality,"contrast":contrast,"grainRange":[-3,3]}); return out,params

def load_manifest(path: Path) -> list[dict]:
    value = json.loads(path.read_bytes())
    records = value.get("records")
    if not isinstance(records, list): raise ValueError("manifest records required")
    selected = [r for r in records if r.get("split") == "train" and r.get("kind") == "board" and r.get("review", {}).get("status") == "accepted"]
    if not selected: raise ValueError("no accepted train boards")
    return selected

def run(manifest_path: Path = WORK / "manifest.json", output: Path = WORK / "augmentation") -> dict:
    started = time.monotonic(); parents = load_manifest(manifest_path); rows=[]; total=0
    for parent in parents:
        source = WORK / "crops" / f"{parent['id']}.png"
        if source.is_symlink() or not source.is_file(): raise ValueError(f"missing crop: {parent['id']}")
        original = source.read_bytes()
        if digest(original) != parent.get("cropSha256"): raise ValueError(f"parent hash mismatch: {parent['id']}")
        with Image.open(BytesIO(original)) as decoded: image=decoded.convert("RGB")
        for name in VARIANTS:
            if time.monotonic()-started > MAX_SECONDS: raise ValueError("augmentation time budget exhausted")
            transformed_image, recipe_params = variant(image, parent["id"], name); transformed = png(transformed_image); total += len(transformed)
            if total > MAX_BYTES: raise ValueError("augmentation storage budget exhausted")
            aid=f"aug-{parent['id']}-{name}"; rel=f"crops/{aid}.png"; publish(output / rel, transformed)
            row={"id":aid,"sourceId":parent["sourceId"],"page":parent["page"],"rect":[0,0,image.width,image.height],"placement":parent["placement"],"orientation":parent["orientation"],"kind":"board","family":parent["family"],"split":"train","tags":[*parent.get("tags",[]),"derived-print-scan","review-pending"],"proposal":{"method":"inherited-reviewed-parent","parentId":parent["id"],"parentCropSha256":parent["cropSha256"]},"review":{"reviewer":None,"type":"pending-human-visual","all64":False,"geometry":False,"status":"pending"},"parentId":parent["id"],"transform":{"name":name,"seedUint64":str(seed_for(parent["id"],name)),"recipe":"real-print-v2","parameters":recipe_params},"cropSha256":digest(transformed),"parentCropSha256":parent["cropSha256"]}
            row["proposalSha256"]=digest(json_bytes({k:row.get(k) for k in ("id","sourceId","page","rect","placement","orientation","kind","family","split","tags","proposal")})); rows.append(row)
    result={"schema":2,"role":"train-augmentation-pending-review","recipe":"real-print-v1","parents":len(parents),"variants":list(VARIANTS),"records":rows,"bytes":total}
    contacts=[]
    for family in sorted({p.get("family") for p in parents}):
        group=[p for p in parents if p.get("family")==family]
        contacts.extend(group[:2])
    contacts=contacts[:8]
    sheet = Image.new("RGB", (640, max(1, len(contacts)) * 150), "white")
    for index, parent in enumerate(contacts):
        paths = [WORK / "crops" / f"{parent['id']}.png"] + [output / "crops" / f"aug-{parent['id']}-{name}.png" for name in VARIANTS]
        for column, path in enumerate(paths):
            with Image.open(path) as tile:
                tile = tile.convert("RGB"); tile.thumbnail((150, 140)); sheet.paste(tile, (column * 160, index * 150))
    publish(output / "contact-sheet.png", png(sheet))
    publish(output / "manifest.json",json_bytes(result)); return {"parents":len(parents),"records":len(rows),"bytes":total,"output":str(output)}

if __name__ == "__main__":
    ap=argparse.ArgumentParser();ap.add_argument("--manifest",type=Path,default=WORK/"manifest.json");ap.add_argument("--output",type=Path,default=WORK/"augmentation");a=ap.parse_args();print(json.dumps(run(a.manifest,a.output),sort_keys=True))
