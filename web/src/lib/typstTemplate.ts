import type { Font } from 'opentype.js';
import type { SignConfig } from './config';
import { DEFAULT_BOX_GAP, DEFAULT_HEADING, DEFAULT_LOGO, DEFAULT_SIGN_COLOR, type Sign, type SignFontSet } from './signs';
import { roomTags, type State } from './model';

/** Family name and weight as Typst sees them (typographic family first, like Typst's font book). */
export function typstFont(font: Font) {
  const n = font.names as unknown as Record<string, Record<string, unknown> | undefined>;
  const get = (k: string) => {
    const v = (n[k] ?? n.windows?.[k] ?? n.macintosh?.[k]) as Record<string, string> | undefined;
    return v?.en ?? (v ? Object.values(v)[0] : undefined);
  };
  const fams = [...new Set([get('fontFamily'), get('preferredFamily')].filter((x): x is string => !!x))];
  return { family: fams.length ? fams : ['IBM Plex Sans'], weight: (font.tables.os2 as { usWeightClass?: number } | undefined)?.usWeightClass ?? 400 };
}

/** Data files for the Typst editor: rooms.json (physical room facts and its number of doors = sign pages), schedule.json (tag and events per room) and notes.json (sign notes). No layout. */
export function typstData(state: State, signs: Sign[]) {
  const first = signs.filter((sg) => sg.copy === 1).map((sg) => ({ sg, r: state.rooms.find((x) => x.id === sg.roomId)! }));
  return {
    rooms: first.map(({ sg, r }) => ({ room: r.id, name: r.name, building: sg.building, floor: sg.floor, number: sg.label, doors: sg.copies })),
    schedule: first.map(({ sg, r }) => { const tag = roomTags(state, r)[0]; return { room: r.id, tag: tag?.name ?? null, color: tag?.color ?? null, events: sg.lines.slice(0, sg.evCount) }; }),
    notes: first.filter(({ sg }) => sg.lines.length > sg.evCount).map(({ sg }) => {
      const st = sg.noteStyle ?? {};
      return { room: sg.roomId, lines: sg.lines.slice(sg.evCount), style: { size: st.size ?? null, font: st.font ?? 'text', bold: !!st.bold, italic: !!st.italic, underline: !!st.underline, strike: !!st.strike } };
    })
  };
}

const str = (s: string) => JSON.stringify(s);
const fam = (f: string[]) => (f.length === 1 ? str(f[0]) : `(${f.map(str).join(', ')})`);
const num = (n: number) => String(Math.round(n * 100) / 100);

/** helpers.typ: small functions the default code uses (an uploaded helpers.typ replaces it). */
export const TYPST_HELPERS = `// Helper functions for the room sign code. To change them, upload your own helpers.typ.
#let pt(n) = n * 1pt   // a number as points
#let at(x, y, body) = place(top + left, dx: pt(x), dy: pt(y), body)   // place body at (x, y); for text, y is the baseline
#let centered(y, body) = at(0, y, box(width: 100%, align(center, body)))   // centered across the page at y
#let width-of(body) = measure(body).width.pt()
#let fit(t, size, max-w, ..font) = {   // the size, shrunk so text t fits in max-w
  let w = width-of(text(pt(size), ..font, t))
  if w > max-w { size * max-w / w } else { size }
}
#let ink(color) = {   // black or white text, whichever reads better on color
  let (r, g, b, _) = rgb(color).components()
  if 0.299 * r + 0.587 * g + 0.114 * b > 60% { black } else { white }
}
`;

/** Typst code that draws the basic editor's signs from the data files, with every setting, size and position in the code. */
export function defaultTypst(cfg: SignConfig, fs: SignFontSet, logoFile: string | null) {
  const tf = typstFont(fs.text.font), nf = typstFont(fs.number.font);
  const footer = (cfg.footer ?? '').trim() ? (cfg.footer ?? '').trim().split('\n').map((l) => l.trim()) : [];
  const list = (xs: string[]) => `(${xs.map(str).join(', ')}${xs.length === 1 ? ',' : ''})`;
  return `// Room signs, generated from the basic editor. Once you edit this code, your version is kept.
// Sizes and positions are in points (72 pt = 1 in) from the page's top-left corner; text positions are baselines.
#import "helpers.typ": *
#let rooms    = json("rooms.json")      // physical rooms: room, name, building, floor, number, doors (= sign pages)
#let schedule = json("schedule.json")   // per room: tag, color (the tag's color) and events, in time order
#let notes    = json("notes.json")      // per room with a sign note: note lines and their style

// ---------- Page ----------
#let page-w = 612   // 8.5 in
#let page-h = 792   // 11 in
#let margin = 36    // 0.5 in, left and right
#set page(width: pt(page-w), height: pt(page-h), margin: 0pt)
#set text(top-edge: "baseline", bottom-edge: "baseline", kerning: false, ligatures: false)

// ---------- Settings ----------
#let text-font      = (font: ${fam(tf.family)}, weight: ${tf.weight})
#let number-font    = (font: ${fam(nf.family)}, weight: ${nf.weight})
#let heading-text   = ${str(cfg.heading ?? DEFAULT_HEADING)}
#let footer-text    = ${list(footer)}
#let logo           = ${logoFile ? str(logoFile) : 'none'}   // none = no logo
#let logo-size      = ${num(cfg.logoSize ?? DEFAULT_LOGO.size)}   // the logo fits in a square this big
#let logo-x         = ${num(cfg.logoX ?? DEFAULT_LOGO.x)}   // logo center, from the left
#let logo-y         = ${cfg.logoY == null ? 'auto' : num(cfg.logoY)}   // top of the logo's square, or auto = centered under the events
#let untagged-color = ${str(cfg.color || DEFAULT_SIGN_COLOR)}   // box color for rooms without a tag
#let stretch        = ${cfg.boxStretch ? 'true' : 'false'}   // true: the room number box widens for long room numbers
#let min-gap        = ${num(cfg.boxGap ?? DEFAULT_BOX_GAP)}   // with stretch: closest the box may come to the building name
#set text(..text-font)

// ---------- One sign ----------
#let sign(r, copy) = {
  pagebreak(weak: true)
  context {
    let s = schedule.find(x => x.room == r.room)
    let n = notes.find(x => x.room == r.room)
    let color = if s.color != none { s.color } else { untagged-color }
    let lines = s.events.map(t => (text: t, note: false)) + if n != none { n.lines.map(t => (text: t, note: true)) } else { () }

    // Copy number ("1 of 2"), top left; only when a room has several doors
    if r.doors > 1 {
      let t = str(copy) + " of " + str(r.doors)
      at(margin, 28, text(pt(fit(t, 12, 200)), fill: luma(136), t))
    }

    // Room number box, top right (0.5 in from the top and right edges), 1.8 in tall, number centered in it
    let w = 259.2
    let size = if r.number.clusters().len() <= 3 { 110 } else { 95 }
    if stretch {
      let name-w = calc.max(width-of(text(50pt, r.building)), width-of(text(25pt, r.floor)))
      w = calc.min(calc.max(w, page-w - 2 * margin - name-w - min-gap), calc.max(w, width-of(text(pt(size), ..number-font, r.number)) + 24))
    }
    let box-x = page-w - margin - w
    let size = calc.floor(fit(r.number, size, w - 24, ..number-font))
    at(box-x, 36, rect(width: pt(w), height: 129.6pt, fill: rgb(color)))
    at(box-x, 36 + 129.6 / 2 + size * 0.348, box(width: pt(w), align(center, text(pt(size), ..number-font, fill: ink(color), r.number))))

    // Building name, top left, shrunk to fit beside the box
    at(margin, 86, text(pt(fit(r.building, 50, box-x - margin - 10)), r.building))

    // Floor, under the building name
    at(margin, 116, text(pt(fit(r.floor, 25, box-x - margin - 10)), r.floor))

    // Heading, centered under the box
    centered(210.6, text(pt(fit(heading-text, 35, page-w - 2 * margin)), heading-text))

    // Divider line under the heading
    at(margin, 218.6, line(length: pt(page-w - 2 * margin), stroke: 1pt))

    // Footer, bottom center: last line at y = 756, lines 20 pt apart
    let foot-top = page-h - margin   // where the footer starts (the bottom margin when there's no footer)
    if footer-text.len() > 0 {
      let foot = box(width: pt(page-w - 2 * margin), align(center, par(leading: 20pt, text(16pt, footer-text.join(linebreak())))))
      let foot-h = measure(foot).height.pt()
      at(margin, 756 - foot-h, foot)
      foot-top = 756 - foot-h - 16
    }

    // Logo size: scaled to fit a logo-size square (the logo is placed after the events)
    let (logo-w, logo-h) = (0, 0)
    if logo != none {
      let ih = measure(image(logo, width: pt(logo-size))).height.pt()
      (logo-w, logo-h) = if ih <= logo-size { (logo-size, ih) } else { (logo-size * logo-size / ih, logo-size) }
    }

    // Event lines, then note lines, centered from y = 240 down to the logo or footer;
    // all events share one size (up to 45 pt) so the widest fits; note lines shrink on their own
    let top = 240
    let bottom = foot-top - 17
    if logo != none and logo-y == auto { bottom -= logo-h * 0.9 }
    else if logo != none {
      let ly = logo-y + (logo-size - logo-h) / 2
      if ly >= 300 { bottom = calc.min(bottom, ly - 10) } else if ly + logo-h > top { top = calc.min(bottom - 40, ly + logo-h + 10) }
    }
    let widest = calc.max(0, ..lines.filter(l => not l.note).map(l => width-of(text(45pt, l.text))))
    let size = calc.min(45, calc.floor(calc.max(20, bottom - top) / (1.246 + 1.3 * calc.max(0, lines.len() - 1))))
    if widest > 526 { size = calc.min(size, calc.floor(45 * 526 / widest)) }
    size = calc.max(6, size)
    let (y, prev, last) = (top, 0, top)
    for (i, l) in lines.enumerate() {
      let st = if l.note { n.style } else { (size: none, font: "text", bold: false, italic: false, underline: false, strike: false) }
      let f = if st.font == "number" { number-font } else { text-font }
      let s = fit(l.text, if st.size != none { st.size } else { size }, page-w - 2 * margin, ..f)
      y = if i == 0 { top + 1.269 * s - 10.5 } else { y + 0.21 * prev + 1.036 * s + calc.min(58, 1.3 * s) - 1.246 * s + (if l.note and s < prev { 10 } else { 0 }) }
      let t = text(pt(s), font: f.font, weight: if st.bold { "bold" } else { f.weight }, style: if st.italic { "italic" } else { "normal" }, l.text)
      if st.underline { t = underline(t) }
      if st.strike { t = strike(t) }
      centered(y, t)
      (prev, last) = (s, y + 9.8)
    }

    // Logo, centered at logo-x; under the events (auto) or at logo-y
    if logo != none {
      let y = if logo-y == auto { calc.min((last + foot-top - 17 - logo-h) / 2, foot-top - 17 - logo-h) } else { logo-y + (logo-size - logo-h) / 2 }
      at(logo-x - logo-w / 2, y, image(logo, width: pt(logo-w)))
    }
  }
}

// ---------- Every room, every door ----------
#for r in rooms {
  for copy in range(1, r.doors + 1) { sign(r, copy) }
}
`;
}
