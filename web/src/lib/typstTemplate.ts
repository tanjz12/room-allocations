import type { Font } from 'opentype.js';
import type { SignConfig } from './config';
import { DEFAULT_HEADING, layoutSign, type Item, type Logo, type Sign, type SignFontSet, type TextItem } from './signs';

/** Family name and weight as Typst sees them (typographic family first, like Typst's font book). */
export function typstFont(font: Font) {
  const n = font.names as unknown as Record<string, Record<string, unknown> | undefined>;
  const get = (k: string) => {
    const v = (n[k] ?? n.windows?.[k] ?? n.macintosh?.[k]) as Record<string, string> | undefined;
    return v?.en ?? (v ? Object.values(v)[0] : undefined);
  };
  return { family: get('preferredFamily') ?? get('fontFamily') ?? 'IBM Plex Sans', weight: (font.tables.os2 as { usWeightClass?: number } | undefined)?.usWeightClass ?? 400 };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** rooms.json: one entry per sign page, with the room's attributes plus the positions and sizes the basic editor computed (points from the page's top-left). */
export function typstRooms(signs: Sign[], cfg: SignConfig, fs: SignFontSet, logo: Logo | null) {
  const fonts = { text: fs.text.font, number: fs.number.font };
  let footer: string[] = [];
  const rooms = signs.map((sg) => {
    const items: Item[] = layoutSign(sg, cfg, fonts, logo);
    let k = 0;
    const next = () => items[k++];
    if (sg.copies > 1) next();
    const building = next() as TextItem;
    const floor = sg.floor ? (next() as TextItem) : null;
    const box = next() as Extract<Item, { kind: 'rect' }>;
    const label = next() as TextItem;
    if (cfg.heading ?? DEFAULT_HEADING) next();
    next();
    const lines = sg.lines.map((_, i) => {
      const t = next() as TextItem, st = t.style ?? {};
      return { text: t.text, note: i >= sg.evCount, y: r1(t.y), size: r1(t.size), number_font: t.font === 'number', bold: !!st.bold, italic: !!st.italic, underline: !!st.underline, strike: !!st.strike };
    });
    const img = items[k]?.kind === 'image' ? (next() as Extract<Item, { kind: 'image' }>) : null;
    footer = (items.slice(k) as TextItem[]).map((t) => t.text);
    return {
      room: sg.roomId, building: sg.building, floor: sg.floor, label: sg.label, copy: sg.copy, copies: sg.copies,
      building_size: r1(building.size), floor_size: r1(floor?.size ?? 25), label_size: r1(label.size),
      box: { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h), color: box.color, ink: label.color },
      lines,
      logo: img && { x: r1(img.x), y: r1(img.y), w: r1(img.w), h: r1(img.h) }
    };
  });
  if (!signs.length && cfg.footer?.trim()) footer = cfg.footer.trim().split('\n').map((l) => l.trim());
  return { rooms, footer };
}

const str = (s: string) => JSON.stringify(s);

/** Typst code that draws the same signs as the basic editor from rooms.json. */
export function defaultTypst(cfg: SignConfig, fs: SignFontSet, footer: string[], logoFile: string | null) {
  const tf = typstFont(fs.text.font), nf = typstFont(fs.number.font);
  const heading = cfg.heading ?? DEFAULT_HEADING;
  return `// Room signs, generated from the basic editor. Edit freely: once changed, this code is kept.
// rooms.json has one entry per page: building, floor, label, copy/copies, lines (events, then note lines),
// plus the positions and sizes the basic editor computed (in points from the page's top-left corner).
#let rooms = json("rooms.json")
#let text-font = ${str(tf.family)}
#let text-weight = ${tf.weight}
#let number-font = ${str(nf.family)}
#let number-weight = ${nf.weight}
#let heading = ${str(heading)}
#let footer = (${footer.map(str).join(', ')}${footer.length === 1 ? ',' : ''})
#let logo = ${logoFile ? str(logoFile) : 'none'}

#set page(width: 8.5in, height: 11in, margin: 0pt)
#set text(font: text-font, weight: text-weight, top-edge: "baseline", bottom-edge: "baseline")

#let pt(n) = n * 1pt
// Places body at (x, y); for text, y is the baseline.
#let at(x, y, body) = place(top + left, dx: pt(x), dy: pt(y), body)
#let centered(y, body) = place(top + left, dy: pt(y), box(width: 100%, align(center, body)))
#let line-text(l) = {
  let t = text(pt(l.size),
    font: if l.number_font { number-font } else { text-font },
    weight: if l.bold { "bold" } else if l.number_font { number-weight } else { text-weight },
    style: if l.italic { "italic" } else { "normal" }, l.text)
  if l.underline { t = underline(t) }
  if l.strike { t = strike(t) }
  t
}

#for (i, r) in rooms.enumerate() {
  if i > 0 { pagebreak() }
  if r.copies > 1 { at(36, 28, text(12pt, fill: rgb("#888888"))[#r.copy of #r.copies]) }
  at(36, 86, text(pt(r.building_size), r.building))
  if r.floor != "" { at(36, 116, text(pt(r.floor_size), r.floor)) }
  at(r.box.x, r.box.y, rect(width: pt(r.box.w), height: pt(r.box.h), fill: rgb(r.box.color)))
  at(r.box.x, r.box.y + r.box.h / 2 + r.label_size * 0.348, box(width: pt(r.box.w), align(center,
    text(pt(r.label_size), font: number-font, weight: number-weight, fill: rgb(r.box.ink), r.label))))
  if heading != "" { centered(210.6, text(35pt, heading)) }
  at(36, 218.6, line(length: 540pt, stroke: 1pt))
  for l in r.lines { centered(l.y, line-text(l)) }
  if logo != none and r.logo != none { at(r.logo.x, r.logo.y, image(logo, width: pt(r.logo.w), height: pt(r.logo.h))) }
  for (j, f) in footer.enumerate() { centered(756 - 20 * (footer.len() - 1 - j), text(16pt, f)) }
}
`;
}
