// @ts-check
/**
 * Minimal, in-file SVG parser for the chessnut piece glyphs (see
 * ../../assets/pieces/chessnut/PROVENANCE.md). These files are a fixed,
 * committed, trusted input (not user-uploaded content), and only ever use a
 * small, consistent subset of SVG: self-closing `<path>`, `<line>`,
 * `<circle>`, and `<ellipse>` elements with either a `style="..."` attribute
 * or plain `fill`/`stroke`/`stroke-width` attributes, occasionally
 * `style="display:none;...` to hide a superseded design variant.
 *
 * Each element becomes one `PieceSubpath`: SVG path data plus the resolved
 * fill/stroke paint, ready to hand to `pdf-lib`'s `page.drawSvgPath` one
 * element at a time (pdf-lib draws a whole `drawSvgPath` call with a single
 * fill/stroke, so a multi-color piece needs one call per source element).
 */

/** @typedef {{ readonly r: number; readonly g: number; readonly b: number }} RgbColor */

/**
 * @typedef {object} PieceSubpath
 * @property {string} d SVG path data, normalized to single-space-separated tokens.
 * @property {RgbColor | null} fill `null` means no fill (SVG `fill:none`).
 * @property {RgbColor | null} stroke `null` means no stroke.
 * @property {number} strokeWidth In the SVG's own user units (the chessnut set uses a
 *   0..800 viewBox); meaningless when `stroke` is `null`.
 */

/** SVG's own default fill when no `fill` is specified anywhere: opaque black. */
const DEFAULT_FILL = /** @type {RgbColor} */ ({ r: 0, g: 0, b: 0 });

/**
 * @param {string} hex `#rgb` or `#rrggbb`, case-insensitive.
 * @returns {RgbColor}
 */
function hexToRgb(hex) {
  const cleaned = hex.trim().replace(/^#/, '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Unsupported SVG color "${hex}"; only #rgb/#rrggbb hex is supported.`);
  }
  const intVal = Number.parseInt(full, 16);
  return {
    r: ((intVal >> 16) & 0xff) / 255,
    g: ((intVal >> 8) & 0xff) / 255,
    b: (intVal & 0xff) / 255,
  };
}

/**
 * @param {string} rawAttrs the attribute text between the tag name and the closing `/>`.
 * @returns {Record<string, string>}
 */
function parseAttrs(rawAttrs) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const attrPattern = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*"([^"]*)"/g;
  for (const match of rawAttrs.matchAll(attrPattern)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) {
      attrs[name] = value;
    }
  }
  return attrs;
}

/**
 * @param {string} style a `key:value;key:value;...` CSS-in-attribute string.
 * @returns {Record<string, string>}
 */
function parseStyle(style) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const part of style.split(';')) {
    const colonIndex = part.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    const key = part.slice(0, colonIndex).trim();
    const value = part.slice(colonIndex + 1).trim();
    if (key.length > 0) {
      map[key] = value;
    }
  }
  return map;
}

/**
 * Resolves fill/stroke/stroke-width for one element, preferring the `style` attribute
 * over plain attributes, and falling back to SVG defaults (fill black, no stroke).
 * Returns `null` when the element carries `display:none` (a superseded design kept in
 * the source file) and must not be rendered at all.
 *
 * @param {Record<string, string>} attrs
 * @returns {{ fill: RgbColor | null; stroke: RgbColor | null; strokeWidth: number } | null}
 */
function resolvePaint(attrs) {
  const style = attrs['style'] !== undefined ? parseStyle(attrs['style']) : {};

  const display = style['display'] ?? attrs['display'];
  if (display === 'none') {
    return null;
  }

  const fillValue = style['fill'] ?? attrs['fill'];
  const strokeValue = style['stroke'] ?? attrs['stroke'];
  const strokeWidthValue = style['stroke-width'] ?? attrs['stroke-width'];

  const fill =
    fillValue === undefined ? DEFAULT_FILL : fillValue === 'none' ? null : hexToRgb(fillValue);
  const stroke = strokeValue === undefined || strokeValue === 'none' ? null : hexToRgb(strokeValue);
  const strokeWidth = strokeWidthValue === undefined ? 0 : Number(strokeWidthValue);

  return { fill, stroke, strokeWidth };
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @returns {string}
 */
function ellipsePathData(cx, cy, rx, ry) {
  // Two 180-degree elliptical arcs make a full ellipse (a single 360-degree arc is
  // degenerate: start and end point coincide, so pdf-lib's arc solver never sees a
  // second sweep). pdf-lib's SVG arc support only exists for A/a, so we use it here.
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

/**
 * @param {'path' | 'line' | 'circle' | 'ellipse'} tagName
 * @param {Record<string, string>} attrs
 * @returns {string | null} normalized path data, or `null` if required attributes are missing.
 */
function toPathData(tagName, attrs) {
  if (tagName === 'path') {
    const d = attrs['d'];
    // SVG path data copied out of an Illustrator export wraps across lines with leading
    // tabs; pdf-lib's path tokenizer only treats space/comma as argument separators, so
    // collapse all whitespace runs (including newlines/tabs) to single spaces first.
    return d === undefined ? null : d.replace(/\s+/g, ' ').trim();
  }
  if (tagName === 'line') {
    const x1 = attrs['x1'];
    const y1 = attrs['y1'];
    const x2 = attrs['x2'];
    const y2 = attrs['y2'];
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
      return null;
    }
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  if (tagName === 'circle') {
    const cx = attrs['cx'];
    const cy = attrs['cy'];
    const r = attrs['r'];
    if (cx === undefined || cy === undefined || r === undefined) {
      return null;
    }
    return ellipsePathData(Number(cx), Number(cy), Number(r), Number(r));
  }
  const cx = attrs['cx'];
  const cy = attrs['cy'];
  const rx = attrs['rx'];
  const ry = attrs['ry'];
  if (cx === undefined || cy === undefined || rx === undefined || ry === undefined) {
    return null;
  }
  return ellipsePathData(Number(cx), Number(cy), Number(rx), Number(ry));
}

/**
 * Parses one chessnut piece SVG into an ordered list of paintable subpaths (document
 * order matters: later elements draw on top of earlier ones, exactly as a browser
 * would render them).
 *
 * @param {string} svgText
 * @returns {PieceSubpath[]}
 */
export function parsePieceSubpaths(svgText) {
  /** @type {PieceSubpath[]} */
  const subpaths = [];
  const tagPattern = /<(path|line|circle|ellipse)\b([^>]*)\/>/g;
  for (const match of svgText.matchAll(tagPattern)) {
    const tagName = /** @type {'path' | 'line' | 'circle' | 'ellipse'} */ (match[1]);
    const rawAttrs = match[2] ?? '';
    const attrs = parseAttrs(rawAttrs);

    const paint = resolvePaint(attrs);
    if (paint === null) {
      continue;
    }
    const d = toPathData(tagName, attrs);
    if (d === null) {
      throw new Error(`Malformed <${tagName}> element (missing required attribute): ${rawAttrs}`);
    }
    subpaths.push({ d, fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth });
  }
  if (subpaths.length === 0) {
    throw new Error('No paintable <path>/<line>/<circle>/<ellipse> elements found in SVG.');
  }
  return subpaths;
}
