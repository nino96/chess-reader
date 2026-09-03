// @ts-check
/**
 * Reproducible, zero-dependency PWA icon generator.
 *
 * Draws a simplified version of `public/icons/icon.svg` (a rounded-square tile with a
 * checkerboard motif) directly into an RGBA pixel buffer using plain rectangle fills, then
 * encodes that buffer as a PNG by hand: signature, IHDR, IDAT, IEND chunks with a
 * from-scratch CRC-32 implementation. Compression (and the Adler-32 checksum the zlib/PNG
 * IDAT stream format requires) is delegated to Node's built-in `node:zlib` `deflateSync`,
 * which is a runtime dependency, not a package dependency.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

/** @typedef {{ r: number; g: number; b: number; a: number }} RGBA */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** @type {Uint32Array} */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Standard CRC-32 (as used by PNG chunk trailers and zip), computed over the given bytes.
 * @param {Buffer} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const tableIndex = (crc ^ byte) & 0xff;
    const tableValue = /** @type {number} */ (CRC_TABLE[tableIndex]);
    crc = (tableValue ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds one length-prefixed, CRC-terminated PNG chunk.
 * @param {string} type exactly 4 ASCII characters, e.g. "IHDR"
 * @param {Buffer} data
 * @returns {Buffer}
 */
export function pngChunk(type, data) {
  if (type.length !== 4) {
    throw new Error(`PNG chunk type must be 4 characters, got "${type}"`);
  }
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

/**
 * Encodes an 8-bit RGBA pixel buffer as a PNG (color type 6, no interlacing, filter type
 * "None" on every scanline).
 * @param {Uint8Array} rgba length must equal width * height * 4
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function encodePng(rgba, width, height) {
  if (rgba.length !== width * height * 4) {
    throw new Error('rgba buffer length does not match width * height * 4');
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: truecolor with alpha
  ihdr.writeUInt8(0, 10); // compression method
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace method

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }

  const idatData = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {Uint8Array} rgba
 * @param {number} size canvas width and height
 * @param {number} x
 * @param {number} y
 * @param {RGBA} color
 */
function setPixel(rgba, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }
  const index = (y * size + x) * 4;
  rgba[index] = color.r;
  rgba[index + 1] = color.g;
  rgba[index + 2] = color.b;
  rgba[index + 3] = color.a;
}

/**
 * True if pixel center (x + 0.5, y + 0.5) falls inside an axis-aligned rounded rectangle of
 * size `w` by `h` with corner radius `r`, anchored at the origin.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @returns {boolean}
 */
export function insideRoundedRect(x, y, w, h, r) {
  if (r <= 0) {
    return true;
  }
  const px = x + 0.5;
  const py = y + 0.5;
  const inCenterX = px >= r && px <= w - r;
  const inCenterY = py >= r && py <= h - r;
  if (inCenterX || inCenterY) {
    return true;
  }
  const cornerX = px < r ? r : w - r;
  const cornerY = py < r ? r : h - r;
  const dx = px - cornerX;
  const dy = py - cornerY;
  return dx * dx + dy * dy <= r * r;
}

/**
 * @param {Uint8Array} rgba
 * @param {number} size canvas width and height, also the outer clip rectangle
 * @param {number} x0
 * @param {number} y0
 * @param {number} w
 * @param {number} h
 * @param {RGBA} color
 * @param {boolean} clipToRounded whether to clip against the outer rounded-rect silhouette
 * @param {number} radius
 */
function fillRect(rgba, size, x0, y0, w, h, color, clipToRounded, radius) {
  const xStart = Math.round(x0);
  const yStart = Math.round(y0);
  const xEnd = Math.min(size, Math.round(x0 + w));
  const yEnd = Math.min(size, Math.round(y0 + h));
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      if (!clipToRounded || insideRoundedRect(x, y, size, size, radius)) {
        setPixel(rgba, size, x, y, color);
      }
    }
  }
}

/** @type {RGBA} */
const BACKGROUND = { r: 15, g: 23, b: 42, a: 255 }; // matches --color-bg (dark) / brand tile color
/** @type {RGBA} */
const LIGHT_SQUARE = { r: 241, g: 245, b: 249, a: 255 }; // matches --color-fg (dark theme)
/** @type {RGBA} */
const MID_SQUARE = { r: 96, g: 165, b: 250, a: 255 }; // matches --color-accent (dark theme)

/**
 * Draws a simplified chessboard tile: a background square (rounded, unless `maskable`) with
 * an inset 4x4 checkerboard.
 * @param {number} size
 * @param {{ rounded: boolean; padding: number }} options `padding` is a fraction of `size`
 *   reserved on every edge before the checkerboard begins (larger for maskable icons, whose
 *   safe zone excludes about the outer 20%).
 * @returns {Uint8Array}
 */
export function drawIcon(size, options) {
  const { rounded, padding } = options;
  const rgba = new Uint8Array(size * size * 4);
  const radius = rounded ? Math.round(size * 0.18) : 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = insideRoundedRect(x, y, size, size, radius);
      setPixel(rgba, size, x, y, inside ? BACKGROUND : { r: 0, g: 0, b: 0, a: 0 });
    }
  }

  const inset = Math.round(size * padding);
  const boardSize = size - inset * 2;
  const cells = 4;
  const cellSize = boardSize / cells;

  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const isLight = (row + col) % 2 === 0;
      fillRect(
        rgba,
        size,
        inset + col * cellSize,
        inset + row * cellSize,
        cellSize,
        cellSize,
        isLight ? LIGHT_SQUARE : MID_SQUARE,
        rounded,
        radius,
      );
    }
  }

  return rgba;
}

/** @type {Array<{ file: string; size: number; rounded: boolean; padding: number }>} */
export const ICON_TARGETS = [
  { file: 'icon-192.png', size: 192, rounded: true, padding: 0.16 },
  { file: 'icon-512.png', size: 512, rounded: true, padding: 0.16 },
  // Maskable icons are displayed edge-to-edge with an OS-applied mask, so the background
  // fills the full canvas (no pre-rounded corners) and the artwork keeps extra padding to
  // stay inside the ~80% "safe zone" most launcher masks use.
  { file: 'icon-maskable-512.png', size: 512, rounded: false, padding: 0.28 },
  { file: 'apple-touch-icon-180.png', size: 180, rounded: true, padding: 0.16 },
];

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

export function generateAllIcons() {
  mkdirSync(iconsDir, { recursive: true });
  for (const target of ICON_TARGETS) {
    const rgba = drawIcon(target.size, { rounded: target.rounded, padding: target.padding });
    const png = encodePng(rgba, target.size, target.size);
    writeFileSync(join(iconsDir, target.file), png);
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  generateAllIcons();
  for (const target of ICON_TARGETS) {
    const bytes = readFileSync(join(iconsDir, target.file)).length;
    console.log(
      `wrote public/icons/${target.file} (${target.size}x${target.size}, ${bytes} bytes)`,
    );
  }
}
