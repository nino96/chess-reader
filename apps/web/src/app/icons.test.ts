// @vitest-environment node
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  crc32,
  drawIcon,
  encodePng,
  ICON_TARGETS,
  insideRoundedRect,
  pngChunk,
} from '../../scripts/generate-icons.mjs';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function readChunks(png: Buffer) {
  const chunks: { type: string; data: Buffer; crc: number }[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    chunks.push({ type, data, crc });
    offset += 12 + length;
  }
  return chunks;
}

describe('pngChunk / crc32', () => {
  it('produces a chunk whose trailing CRC matches an independent CRC-32 of type+data', () => {
    const data = Buffer.from('hello world');
    const chunk = pngChunk('tEXt', data);

    const length = chunk.readUInt32BE(0);
    const type = chunk.subarray(4, 8).toString('ascii');
    const crc = chunk.readUInt32BE(chunk.length - 4);

    expect(length).toBe(data.length);
    expect(type).toBe('tEXt');
    expect(crc).toBe(crc32(Buffer.concat([Buffer.from('tEXt', 'ascii'), data])));
  });

  it('matches the well-known CRC-32 of the ASCII string "123456789" (0xCBF43926)', () => {
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);
  });
});

describe('encodePng', () => {
  it('encodes a tiny 2x2 image with a valid signature, IHDR, and chunk CRCs', () => {
    const width = 2;
    const height = 2;
    const rgba = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);

    const png = encodePng(rgba, width, height);

    expect(Array.from(png.subarray(0, 8))).toEqual(PNG_SIGNATURE);

    const chunks = readChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);

    for (const chunk of chunks) {
      const typeBuf = Buffer.from(chunk.type, 'ascii');
      expect(chunk.crc).toBe(crc32(Buffer.concat([typeBuf, chunk.data])));
    }

    const ihdr = chunks[0]?.data;
    if (!ihdr) throw new Error('missing IHDR chunk');
    expect(ihdr.readUInt32BE(0)).toBe(width);
    expect(ihdr.readUInt32BE(4)).toBe(height);
    expect(ihdr.readUInt8(8)).toBe(8); // bit depth
    expect(ihdr.readUInt8(9)).toBe(6); // color type: RGBA
    expect(ihdr.readUInt8(10)).toBe(0); // compression method
    expect(ihdr.readUInt8(11)).toBe(0); // filter method
    expect(ihdr.readUInt8(12)).toBe(0); // interlace method

    const idat = chunks[1]?.data;
    if (!idat) throw new Error('missing IDAT chunk');
    const inflated = inflateSync(idat);
    // Each scanline is prefixed with a 1-byte filter type, so a width*4 RGBA row is
    // (width*4 + 1) bytes; there are `height` such rows.
    expect(inflated.length).toBe((width * 4 + 1) * height);
    // Every row starts with filter type 0 (None).
    for (let row = 0; row < height; row += 1) {
      expect(inflated[row * (width * 4 + 1)]).toBe(0);
    }
  });

  it('rejects a buffer whose length does not match width * height * 4', () => {
    expect(() => encodePng(new Uint8Array(3), 1, 1)).toThrow();
  });
});

describe('insideRoundedRect', () => {
  it('treats a zero radius as a plain rectangle', () => {
    expect(insideRoundedRect(0, 0, 10, 10, 0)).toBe(true);
    expect(insideRoundedRect(9, 9, 10, 10, 0)).toBe(true);
  });

  it('excludes the extreme corner pixel once a radius is applied', () => {
    expect(insideRoundedRect(0, 0, 20, 20, 6)).toBe(false);
    expect(insideRoundedRect(10, 10, 20, 20, 6)).toBe(true);
  });
});

describe('drawIcon', () => {
  it('produces an RGBA buffer sized for the requested canvas', () => {
    const rgba = drawIcon(16, { rounded: true, padding: 0.16 });
    expect(rgba.length).toBe(16 * 16 * 4);
  });

  it('leaves fully transparent pixels only in rounded corners, never in the maskable variant', () => {
    const rounded = drawIcon(32, { rounded: true, padding: 0.16 });
    const maskable = drawIcon(32, { rounded: false, padding: 0.28 });

    // Top-left corner pixel is clipped away for the rounded variant.
    expect(rounded[3]).toBe(0);
    // The maskable variant fills every pixel (its background spans the full canvas).
    expect(maskable[3]).toBe(255);
  });
});

describe('committed icon files', () => {
  const iconsDir = new URL('../../public/icons/', import.meta.url);

  it.each(ICON_TARGETS)('$file parses as a PNG with the expected dimensions', (target) => {
    const bytes = readFileSync(new URL(target.file, iconsDir));
    expect(Array.from(bytes.subarray(0, 8))).toEqual(PNG_SIGNATURE);

    // IHDR is always the first chunk, directly after the 8-byte signature and the 8-byte
    // length+type header of that first chunk.
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(width).toBe(target.size);
    expect(height).toBe(target.size);
  });

  it('includes the hand-written source SVG under 2 KB', () => {
    const bytes = readFileSync(new URL('icon.svg', iconsDir));
    expect(bytes.length).toBeLessThan(2048);
    expect(bytes.toString('utf-8')).toContain('<svg');
  });
});
