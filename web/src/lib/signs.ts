import { jsPDF } from 'jspdf';
import { parse, type Font, type Path } from 'opentype.js';
import { roomActive, roomTags, type Block, type EventT, type Room, type State } from './model';
import type { NoteStyle, SignConfig, SignFontFile } from './config';
import { pathData } from './text';
import { sanitizeSvg } from './maps';
import { svg2pdf } from 'svg2pdf.js';

/** US Letter portrait, in points. */
export const SIGN_W = 612;
export const SIGN_H = 792;
export const DEFAULT_SIGN_COLOR = '#2735e4';
export const DEFAULT_HEADING = 'events';
/** Stretched room number box: default minimum gap (pt) between the building name and the box, about the gap next to “Dwinelle” on a fixed box. */
export const DEFAULT_BOX_GAP = 86.4;
const M = 36;
/** Matches the BmMT 2026 signs: a 2 in square, centered across, and (with no `logoY`) midway between the last event and the footer. */
export const DEFAULT_LOGO = { size: 144, x: SIGN_W / 2 };
export const logoBox = (cfg: SignConfig) => ({ size: cfg.logoSize ?? DEFAULT_LOGO.size, x: cfg.logoX ?? DEFAULT_LOGO.x, y: cfg.logoY });

export type Sign = { roomId: string; building: string; floor: string; label: string; lines: string[]; copy: number; copies: number; box: string; evCount: number; noteStyle?: NoteStyle };
/** Parsed fonts for layout: event/body text and the room number. */
export type SignFonts = { text: Font; number: Font };

/** The room-number box takes the room's first tag color (the same tag that colors the maps); untagged rooms use the default. */
export function boxColor(s: State, r: Room) {
  const tag = roomTags(s, r)[0];
  return tag ? tag.color : s.config.signs?.color || DEFAULT_SIGN_COLOR;
}
/** Black or white, whichever reads better on `hex`. */
export function ink(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16) || 0;
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#000000' : '#ffffff';
}
export type Logo = { src: string; w: number; h: number };

const LOGO_RE = /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
export const validLogo = (s: unknown): s is string => typeof s === 'string' && LOGO_RE.test(s);
export const isSvgLogo = (src: string) => src.startsWith('data:image/svg+xml');
const textToB64 = (t: string) => {
  const u = new TextEncoder().encode(t);
  let out = '';
  for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(out);
};
export const svgLogoText = (src: string) => new TextDecoder().decode(Uint8Array.from(atob(src.split(',')[1] ?? ''), (c) => c.charCodeAt(0)));
/** SVG logos are stored as sanitized SVG data URLs, so the PDF keeps them as vectors. */
export const svgLogoUrl = (text: string) => `data:image/svg+xml;base64,${textToB64(sanitizeSvg(text))}`;
const svgEl = (src: string) => new DOMParser().parseFromString(svgLogoText(src), 'image/svg+xml').documentElement;
function svgSize(src: string) {
  const d = svgEl(src);
  const vb = (d.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  return { w: parseFloat(d.getAttribute('width') ?? '') || vb[2] || 100, h: parseFloat(d.getAttribute('height') ?? '') || vb[3] || 100 };
}

/** "DWIN145" → "145", "WHLR 150" → "150", "Pauley" → "Pauley". */
export const defaultLabel = (r: Room) => r.name.replace(/^[A-Za-z]+\s*(?=\d)/, '').trim() || r.name;

/** The label printed for a block: its room-only label, else the event's sign name, else the event name. */
export const signLabel = (e: EventT, b?: Block) => b?.signName?.trim() || e.signName?.trim() || e.name;

/** Events shown on a room's sign: its scheduled events in time order, by sign name, each once. */
export function signEvents(s: State, r: Room): string[] {
  const evs = s.blocks.filter((b) => b.roomId === r.id).map((b) => ({ b, e: s.events.find((e) => e.id === b.eventId) }))
    .filter((x): x is { b: Block; e: EventT } => !!x.e && !x.e.signHide)
    .sort(({ e: a }, { e: b }) => Number(!!b.signFirst) - Number(!!a.signFirst) || a.start - b.start || a.end - b.end);
  const out: string[] = [];
  // A sign label can span several lines (one per line break), e.g. three events that share one schedule cell.
  for (const { b, e } of evs) for (const n of signLabel(e, b).split('\n').map((x) => x.trim())) if (n && !out.includes(n)) out.push(n);
  return out;
}

/** Rooms that are in use get a sign; extra copies are numbered "1 of 2", "2 of 2". */
export const signRooms = (s: State) => s.rooms.filter((r) => roomActive(r) && s.blocks.some((b) => b.roomId === r.id));
export function buildSigns(s: State): Sign[] {
  return signRooms(s).filter((r) => !r.sign?.hide).flatMap((r) => {
    const ev = signEvents(s, r);
    if (!ev.length) return [];
    const note = (r.sign?.note ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    const copies = Math.max(1, Math.min(20, Math.round(r.sign?.copies ?? 1)));
    const base = { roomId: r.id, building: r.sign?.building?.trim() || r.building, floor: r.sign?.floor?.trim() ?? '', label: r.sign?.label?.trim() || defaultLabel(r), lines: [...ev, ...note], copies , box: boxColor(s, r), evCount: ev.length, noteStyle: r.sign?.noteStyle };
    return Array.from({ length: copies }, (_, i) => ({ ...base, copy: i + 1 }));
  });
}

export type TextItem = { kind: 'text'; text: string; x: number; y: number; size: number; color: string; anchor: 'start' | 'middle'; box: number; font: 'text' | 'number'; style?: NoteStyle };
const styled = (st?: NoteStyle) => !!st && !!(st.bold || st.italic || st.underline || st.strike);
const SKEW = 0.21;
/** Widest event line before every event line shrinks (about 7.3 in, as on the BmMT 2026 signs). */
const EVENT_W = 526;
export type Item = TextItem
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'line'; x1: number; x2: number; y: number }
  | { kind: 'image'; x: number; y: number; w: number; h: number; src: string };

/** Plain per-character advances and outlines (no kerning or OpenType features), which every TrueType font supports and matches how jsPDF sets text. */
const adv = (font: Font, text: string, size: number) => {
  let w = 0;
  for (const ch of text) w += font.charToGlyph(ch).advanceWidth ?? 0;
  return (w * size) / font.unitsPerEm;
};
/** Glyph outlines as plain commands, slanted for italic (about 12°, around the baseline). */
type Cmd = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };
function glyphCmds(font: Font, text: string, x: number, y: number, size: number, anchor: 'start' | 'middle', italic?: boolean): Cmd[] {
  let cx = anchor === 'middle' ? x - adv(font, text, size) / 2 : x;
  const out: Cmd[] = [];
  const sk = (px?: number, py?: number) => (px == null || py == null ? px : italic ? px + SKEW * (y - py) : px);
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    for (const c of g.getPath(cx, y, size).commands as Cmd[]) out.push({ ...c, x: sk(c.x, c.y), x1: sk(c.x1, c.y1), x2: sk(c.x2, c.y2) });
    cx += ((g.advanceWidth ?? 0) * size) / font.unitsPerEm;
  }
  return out;
}
/** Underline/strikethrough bars for a styled line. */
function decoBars(font: Font, it: TextItem) {
  const w = adv(font, it.text, it.size), x0 = it.anchor === 'middle' ? it.x - w / 2 : it.x, h = Math.max(0.6, it.size * 0.05);
  const bars: { x: number; y: number; w: number; h: number }[] = [];
  if (it.style?.underline) bars.push({ x: x0, y: it.y + it.size * 0.1, w, h });
  if (it.style?.strike) bars.push({ x: x0, y: it.y - it.size * 0.3, w, h });
  return bars;
}
function glyphPath(font: Font, text: string, x: number, y: number, size: number, anchor: 'start' | 'middle') {
  let cx = anchor === 'middle' ? x - adv(font, text, size) / 2 : x;
  let d = '';
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    d += pathData(g.getPath(cx, y, size));
    cx += ((g.advanceWidth ?? 0) * size) / font.unitsPerEm;
  }
  return d;
}
const fit = (font: Font, text: string, size: number, max: number) => {
  const w = adv(font, text, size);
  return w > max ? (size * max) / w : size;
};
function wrap(font: Font, text: string, size: number, max: number) {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && adv(font, next, size) > max) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** One sign as positioned items, shared by the SVG/PDF and Slides output so both look the same. */
export function layoutSign(sg: Sign, cfg: SignConfig, fonts: SignFonts, logo?: Logo | null): Item[] {
  const font = fonts.text;
  const items: Item[] = [];
  const text = (t: string, x: number, y: number, size: number, box: number, anchor: 'start' | 'middle' = 'start', color = '#000000', fk: 'text' | 'number' = 'text', style?: NoteStyle) =>
    items.push({ kind: 'text', text: t, x, y, size: fit(fonts[fk], t, size, box), color, anchor, box, font: fk, style });
  if (sg.copies > 1) text(`${sg.copy} of ${sg.copies}`, M, 28, 12, 200, 'start', '#888888');
  const want = [...sg.label].length <= 3 ? 110 : 95;
  const fixedW = SIGN_W - M - 316.8;
  let bw = fixedW;
  // Stretch: the box grows to the left so the room number keeps its full size, but stops at the minimum gap from the building name.
  if (cfg.boxStretch) {
    const nameW = Math.max(adv(font, sg.building, 50), sg.floor ? adv(font, sg.floor, 25) : 0);
    const maxW = Math.max(fixedW, SIGN_W - 2 * M - nameW - (cfg.boxGap ?? DEFAULT_BOX_GAP));
    bw = Math.min(maxW, Math.max(fixedW, adv(fonts.number, sg.label, want) + 24));
  }
  const bx = SIGN_W - M - bw, by = 36, bh = 129.6;
  text(sg.building, M, 86, 50, bx - M - 10);
  if (sg.floor) text(sg.floor, M, 116, 25, bx - M - 10);
  items.push({ kind: 'rect', x: bx, y: by, w: bw, h: bh, color: sg.box });
  // BmMT 2026: 110 pt for up to 3 characters, 95 pt for longer labels, then shrunk to fit the box.
  const ls = Math.floor(fit(fonts.number, sg.label, want, bw - 24));
  items.push({ kind: 'text', text: sg.label, x: bx + bw / 2, y: by + bh / 2 + ls * 0.348, size: ls, color: ink(sg.box), anchor: 'middle', box: bw - 24, font: 'number' });
  const heading = cfg.heading ?? DEFAULT_HEADING;
  if (heading) text(heading, SIGN_W / 2, 210.6, 35, SIGN_W - 2 * M, 'middle');
  items.push({ kind: 'line', x1: M, x2: SIGN_W - M, y: 218.6 });

  const footer = cfg.footer?.trim() ? cfg.footer.trim().split('\n').flatMap((l) => (l.trim() ? wrap(font, l.trim(), 16, SIGN_W - 2 * M) : [''])) : [];
  const footTop = footer.length ? 756 - 20 * (footer.length - 1) - 16 : SIGN_H - M;
  const lb = logoBox(cfg);
  const footRef = footTop - 17;
  let top = 240, bottom = footRef;
  const size = logo ? (() => { const sc = lb.size / Math.max(logo.w, logo.h); return { w: logo.w * sc, h: logo.h * sc }; })() : null;
  // BmMT 2026: events may run into the top of the logo's slot; the logo then sits as low as the footer allows.
  if (size && lb.y == null) bottom = footRef - size.h * 0.9;
  else if (size && lb.y != null) {
    // Events stay clear of a placed logo: above it when it sits low on the page, below it when it sits high.
    const y = lb.y + (lb.size - size.h) / 2;
    if (y >= 300) bottom = Math.min(bottom, y - 10);
    else if (y + size.h > top) top = Math.min(bottom - 40, y + size.h + 10);
  }
  const n = sg.lines.length;
  // BmMT 2026 rules: whole-point sizes up to 45 pt, line pitch 1.3× the size (58 pt at most), and one size for all
  // event lines, small enough for the widest; note lines start at that size (or their set size) and shrink on their own.
  const pitch = (sz: number) => Math.min(58, 1.3 * sz);
  const widest = Math.max(0, ...sg.lines.slice(0, sg.evCount).map((l) => adv(font, l, 45)));
  let ev = Math.min(45, Math.floor(Math.max(20, bottom - top) / (1.246 + 1.3 * Math.max(0, n - 1))));
  if (widest > EVENT_W) ev = Math.min(ev, Math.floor((45 * EVENT_W) / widest));
  ev = Math.max(6, ev);
  let base = top, last = top, prev = 0;
  sg.lines.forEach((l, i) => {
    const note = i >= sg.evCount, fk = note ? sg.noteStyle?.font ?? 'text' : 'text';
    const sz = fit(fonts[fk], l, note && sg.noteStyle?.size ? sg.noteStyle.size : ev, SIGN_W - 2 * M);
    base = i ? base + 0.21 * prev + 1.036 * sz + (pitch(sz) - 1.246 * sz) + (note && sz < prev ? 10 : 0) : top + 1.269 * sz - 10.5;
    text(l, SIGN_W / 2, base, sz, SIGN_W - 2 * M, 'middle', '#000000', fk, note ? sg.noteStyle : undefined);
    last = base + 9.8;
    prev = sz;
  });
  if (logo && size) {
    const y = lb.y == null ? Math.min((last + footRef - size.h) / 2, footRef - size.h) : lb.y + (lb.size - size.h) / 2;
    items.push({ kind: 'image', x: lb.x - size.w / 2, y, w: size.w, h: size.h, src: logo.src });
  }
  footer.forEach((l, i) => text(l, SIGN_W / 2, 756 - 20 * (footer.length - 1 - i), 16, SIGN_W - 2 * M, 'middle'));
  return items;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export function signSvg(sg: Sign, cfg: SignConfig, fonts: SignFonts, logo?: Logo | null): string {
  const body = layoutSign(sg, cfg, fonts, logo).map((it) => {
    if (it.kind === 'rect') return `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${esc(it.color)}"/>`;
    if (it.kind === 'line') return `<line x1="${it.x1}" y1="${it.y}" x2="${it.x2}" y2="${it.y}" stroke="#000" stroke-width="1"/>`;
    if (it.kind === 'image') return validLogo(it.src) ? `<image x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" href="${it.src}"/>` : '';
    const f = fonts[it.font];
    if (!styled(it.style)) return `<path fill="${it.color}" d="${glyphPath(f, it.text, it.x, it.y, it.size, it.anchor)}"/>`;
    const d = pathData({ commands: glyphCmds(f, it.text, it.x, it.y, it.size, it.anchor, it.style?.italic) } as unknown as Path);
    const bold = it.style?.bold ? ` stroke="${it.color}" stroke-width="${(it.size * 0.04).toFixed(2)}" stroke-linejoin="round"` : '';
    return `<path fill="${it.color}"${bold} d="${d}"/>` + decoBars(f, it).map((b) => `<rect x="${b.x.toFixed(2)}" y="${b.y.toFixed(2)}" width="${b.w.toFixed(2)}" height="${b.h.toFixed(2)}" fill="${it.color}"/>`).join('');
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIGN_W}" height="${SIGN_H}" viewBox="0 0 ${SIGN_W} ${SIGN_H}"><rect width="${SIGN_W}" height="${SIGN_H}" fill="#fff"/>${body}</svg>`;
}

export const logoSize = (src?: string): Promise<Logo | null> => !validLogo(src) ? Promise.resolve(null) : isSvgLogo(src) ? Promise.resolve({ src, ...svgSize(src) }) : new Promise((ok) => {
  const img = new Image();
  img.onload = () => ok({ src, w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
  img.onerror = () => ok(null);
  img.src = src;
});

/** Text font for the signs: parsed for layout, base64 for the PDF, family name for Slides. */
export type SignFont = { font: Font; b64: string; family: string };
const toB64 = (b: ArrayBuffer) => {
  const u = new Uint8Array(b);
  let out = '';
  for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(out);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
export const validFont = (f: unknown): f is SignFontFile => {
  const x = f as SignFontFile | null;
  return !!x && typeof x === 'object' && typeof x.name === 'string' && typeof x.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(x.data);
};
const fonts = new Map<string, Promise<SignFont>>();
const BUILT_IN = { text: { file: 'IBMPlexSans-Regular.ttf', family: 'IBM Plex Sans' }, number: { file: 'IBMPlexSans-Medium.ttf', family: 'IBM Plex Sans Medium' } };
/** The uploaded font, or the built-in IBM Plex Sans (Medium for room numbers) when none is set. */
export function loadSignFont(f?: SignFontFile, kind: 'text' | 'number' = 'text'): Promise<SignFont> {
  const key = f?.data ?? `built-in:${kind}`;
  let p = fonts.get(key);
  if (!p) {
    p = f ? new Promise<SignFont>((ok) => ok({ font: parse(fromB64(f.data)), b64: f.data, family: f.name }))
      : fetch(`${import.meta.env.BASE_URL}fonts/${BUILT_IN[kind].file}`).then((r) => r.arrayBuffer()).then((b) => ({ font: parse(b), b64: toB64(b), family: BUILT_IN[kind].family }));
    p.catch(() => fonts.delete(key));
    fonts.set(key, p);
  }
  return p;
}
export const DEFAULT_FONT = { family: 'IBM Plex Sans', weight: { text: 400, number: 500 } };
export type GoogleFont = { id: string; family: string; weights: number[] };
let googleList: Promise<GoogleFont[]> | null = null;
/** Google Fonts via Fontsource, which serves CORS-enabled .ttf files (Google's own API only gives browsers woff2). */
export function googleFonts(): Promise<GoogleFont[]> {
  googleList ??= fetch('https://api.fontsource.org/v1/fonts?type=google')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<(GoogleFont & { subsets: string[]; styles: string[] })[]>; })
    .then((l) => l.filter((f) => f.subsets.includes('latin') && f.styles.includes('normal')).map(({ id, family, weights }) => ({ id, family, weights })));
  googleList.catch(() => { googleList = null; });
  return googleList;
}
const fontUrl = (id: string, w: number, ext: 'ttf' | 'woff2') => `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${w}-normal.${ext}`;
const previewed = new Set<string>();
/** Loads a font under the name `gf-<id>` so the picker can show each family in its own face. */
export function previewGoogleFont(f: GoogleFont) {
  if (previewed.has(f.id)) return;
  previewed.add(f.id);
  new FontFace(`gf-${f.id}`, `url(${fontUrl(f.id, nearestWeight(f.weights, 400), 'woff2')})`).load().then((ff) => document.fonts.add(ff), () => {});
}
const WEIGHTS: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
export const weightName = (w: number) => WEIGHTS[w] ?? String(w);
export const nearestWeight = (ws: number[], w: number) => ws.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), ws[0] ?? 400);
export async function googleFontFile(f: GoogleFont, weight: number): Promise<SignFontFile> {
  const r = await fetch(fontUrl(f.id, weight, 'ttf')).catch(() => null);
  if (!r?.ok) throw new Error(`couldn't download ${f.family}; try again or pick another font`);
  const b = await r.arrayBuffer();
  let font: Font;
  try { font = parse(b); } catch { throw new Error(`${f.family} can't be read; pick another font`); }
  if (font.outlinesFormat !== 'truetype') throw new Error(`${f.family} can't be embedded in the PDF; pick another font`);
  return { name: weight === 400 ? f.family : `${f.family} ${weightName(weight)}`, data: toB64(b), google: { family: f.family, weight } };
}
/** Only TrueType outlines can be embedded by jsPDF, so CFF-based .otf files are refused. */
export async function fontFromFile(file: File): Promise<SignFontFile> {
  const b = await file.arrayBuffer();
  let font: Font;
  try { font = parse(b); } catch { throw new Error('that file is not a font the browser can read; use a .ttf file'); }
  if (font.outlinesFormat !== 'truetype') throw new Error("that font has PostScript (CFF) outlines, which can't be embedded in the PDF; use its .ttf version");
  try { glyphPath(font, 'Room 123 events', 0, 0, 20, 'start'); } catch { throw new Error("that font can't be laid out by the browser; try another .ttf file"); }
  const names = font.names as unknown as Record<string, Record<string, string> | undefined>;
  const fam = names.preferredFamily?.en || names.fontFamily?.en || file.name.replace(/\.[^.]+$/, '');
  const sub = (names.preferredSubfamily?.en || names.fontSubfamily?.en || '').trim();
  const name = /^(regular|normal|book|roman)?$/i.test(sub) ? fam : `${fam} ${sub}`;
  return { name, data: toB64(b) };
}

/** Drawn with jsPDF directly: the font and logo are embedded once, so the file stays small. */
export type SignFontSet = { text: SignFont; number: SignFont };
const fontsOf = (fs: SignFontSet): SignFonts => ({ text: fs.text.font, number: fs.number.font });
export async function signsPdf(signs: Sign[], cfg: SignConfig, fs: SignFontSet, logo: Logo | null, onPage?: (i: number) => void): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
  doc.addFileToVFS('sign-font.ttf', fs.text.b64);
  doc.addFont('sign-font.ttf', 'SignFont', 'normal');
  const twoFonts = fs.number.b64 !== fs.text.b64;
  if (twoFonts) { doc.addFileToVFS('sign-number.ttf', fs.number.b64); doc.addFont('sign-number.ttf', 'SignNumber', 'normal'); }
  doc.setFont('SignFont', 'normal');
  const fonts = fontsOf(fs);
  const styledText = (it: TextItem) => {
    const f = fonts[it.font];
    const ops: { op: string; c: number[] }[] = [];
    let cx = 0, cy = 0;
    for (const c of glyphCmds(f, it.text, it.x, it.y, it.size, it.anchor, it.style?.italic)) {
      if (c.type === 'M' || c.type === 'L') { ops.push({ op: c.type.toLowerCase(), c: [c.x!, c.y!] }); cx = c.x!; cy = c.y!; }
      else if (c.type === 'C') { ops.push({ op: 'c', c: [c.x1!, c.y1!, c.x2!, c.y2!, c.x!, c.y!] }); cx = c.x!; cy = c.y!; }
      else if (c.type === 'Q') { ops.push({ op: 'c', c: [cx + (2 / 3) * (c.x1! - cx), cy + (2 / 3) * (c.y1! - cy), c.x! + (2 / 3) * (c.x1! - c.x!), c.y! + (2 / 3) * (c.y1! - c.y!), c.x!, c.y!] }); cx = c.x!; cy = c.y!; }
      else ops.push({ op: 'h', c: [] });
    }
    doc.setFillColor(it.color);
    if (ops.length) {
      if (it.style?.bold) { doc.setDrawColor(it.color); doc.setLineWidth(it.size * 0.04); doc.setLineJoin('round'); doc.path(ops).fillStroke(); }
      else doc.path(ops).fill();
    }
    for (const b of decoBars(f, it)) doc.rect(b.x, b.y, b.w, b.h, 'F');
  };
  for (let i = 0; i < signs.length; i++) {
    onPage?.(i);
    if (i) doc.addPage('letter', 'portrait');
    for (const it of layoutSign(signs[i], cfg, fonts, logo)) {
      if (it.kind === 'rect') { doc.setFillColor(it.color); doc.rect(it.x, it.y, it.w, it.h, 'F'); }
      else if (it.kind === 'line') { doc.setDrawColor('#000000'); doc.setLineWidth(1); doc.line(it.x1, it.y, it.x2, it.y); }
      else if (it.kind === 'image') {
        if (!validLogo(it.src)) continue;
        if (isSvgLogo(it.src)) await svg2pdf(svgEl(it.src), doc, { x: it.x, y: it.y, width: it.w, height: it.h });
        else doc.addImage(it.src, it.src.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', it.x, it.y, it.w, it.h, 'sign-logo', 'SLOW');
      }
      else if (styled(it.style)) styledText(it);
      else { doc.setFont(it.font === 'number' && twoFonts ? 'SignNumber' : 'SignFont', 'normal'); doc.setFontSize(it.size); doc.setTextColor(it.color); doc.text(it.text, it.x, it.y, { align: it.anchor === 'middle' ? 'center' : 'left', baseline: 'alphabetic' }); }
    }
    if (i % 8 === 7) await new Promise((r) => setTimeout(r));
  }
  return doc.output('blob');
}

/** Uploaded logos are redrawn as PNG (max 600 px) so the PDF and Slides can embed them. */
export async function logoFromFile(f: File): Promise<string> {
  if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)) {
    const t = await f.text();
    if (!/<svg[\s>]/i.test(t)) throw new Error('that file is not an SVG');
    return svgLogoUrl(t);
  }
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('that file is not an image the browser can read')); img.src = url; });
    const w = img.naturalWidth || 600, h = img.naturalHeight || 600;
    const sc = Math.min(1, 600 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
