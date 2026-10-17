import { parse, type Font, type Path } from 'opentype.js';

let fontP: Promise<Font> | null = null;
export const loadFont = () =>
  (fontP ??= fetch(`${import.meta.env.BASE_URL}fonts/IBMPlexSans-Medium.ttf`).then((r) => r.arrayBuffer()).then((b) => parse(b)));

// Returns SVG path data for `text` with its left baseline at (x, y); shrinks to fit maxWidth.
export function textPath(font: Font, text: string, x: number, y: number, size: number, maxWidth?: number, anchor: 'start' | 'middle' = 'start') {
  const opts = { kerning: true, features: { liga: false, rlig: false } };
  let s = size;
  let w = font.getAdvanceWidth(text, s, opts);
  if (maxWidth && w > maxWidth) { s = (s * maxWidth) / w; w = maxWidth; }
  const x0 = anchor === 'middle' ? x - w / 2 : x;
  return { d: pathData(font.getPath(text, x0, y, s, opts)), size: s };
}

/** SVG path data with 2 decimals; opentype.js's own toPathData sometimes emits NaN when rounding. */
export function pathData(p: Path) {
  const n = (v: number | undefined) => (v ?? 0).toFixed(2);
  return p.commands.map((c) => {
    switch (c.type) {
      case 'M': case 'L': return `${c.type}${n(c.x)} ${n(c.y)}`;
      case 'Q': return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
      case 'C': return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
      default: return 'Z';
    }
  }).join('');
}
