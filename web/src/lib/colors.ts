import type { State } from './model';

type RGB = [number, number, number];
const hexRgb = (h: string): RGB | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lab = ([r, g, b]: RGB) => {
  const f = (c: number) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = t((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = t(R * 0.2126 + G * 0.7152 + B * 0.0722), z = t((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
/** CIEDE2000 color difference: about 2 is barely noticeable, 10+ clearly different colors. */
export const deltaE = (p: number[], q: number[]) => {
  const [L1, a1, b1] = p, [L2, a2, b2] = q, rad = Math.PI / 180;
  const C = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2, G = 0.5 * (1 - Math.sqrt(C ** 7 / (C ** 7 + 25 ** 7)));
  const A1 = a1 * (1 + G), A2 = a2 * (1 + G), C1 = Math.hypot(A1, b1), C2 = Math.hypot(A2, b2);
  const h = (b: number, a: number) => (Math.atan2(b, a) / rad + 360) % 360, h1 = h(b1, A1), h2 = h(b2, A2);
  let dh = h2 - h1; if (C1 * C2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dL = L2 - L1, dC = C2 - C1, dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2, Cm = (C1 + C2) / 2;
  let hm = h1 + h2; if (C1 * C2 !== 0) hm = Math.abs(h1 - h2) > 180 ? (hm + (hm < 360 ? 360 : -360)) / 2 : hm / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cm, SH = 1 + 0.015 * Cm * T;
  const RT = -2 * Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
};
const dist = deltaE;
export const labOf = (hex: string) => lab(hexRgb(hex)!);
const hsl = ([r, g, b]: RGB) => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
};
const fromHsl = (h: number, s: number, l: number) => {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const c = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${c(0)}${c(8)}${c(4)}`;
};

/** Any CSS color (#abc, #aabbcc, names like "teal", rgb(...)) as #rrggbb, or null if it isn't one. */
export function normalizeColor(v: string): string | null {
  const s = v.trim();
  if (/^#?[0-9a-f]{3}$/i.test(s)) return `#${s.replace('#', '').split('').map((c) => c + c).join('')}`.toLowerCase();
  if (/^#?[0-9a-f]{6}$/i.test(s)) return `#${s.replace('#', '')}`.toLowerCase();
  if (!s || typeof document === 'undefined') return null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000001';
  ctx.fillStyle = s;
  const out = String(ctx.fillStyle);
  return out === '#000001' || !out.startsWith('#') ? null : out;
}

export function usedColors(s: State): string[] {
  const cs = [
    ...s.events.map((e) => e.color), ...s.categories.map((c) => c.color), ...s.phases.map((p) => p.color),
    ...(s.config.sameColors ?? []).map((c) => c.color), ...(s.config.colorOptions ?? []).flatMap((o) => o.colors.map((c) => c.color)),
    ...Object.values(s.mapColors ?? {}),
    ...(s.config.legendExtras ?? []).map((x) => x.color),
    ...s.config.maps.flatMap((m) => [m.floor, ...svgFills(m.svg)]),
  ];
  return [...new Set(cs.filter(Boolean).map((c) => normalizeColor(c) ?? c.toLowerCase()))];
}
/** Hex fill colors drawn in a floor plan SVG (stairs, bathrooms, walls…). */
const svgFills = (svg: string) => [...new Set([...svg.matchAll(/fill(?:="|:\s*)(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b/gi)].map((m) => m[1]))];

// Light colors from Paper Heart Design's "Peaceful Palettes" (paperheartdesign.com/blog/color-palette-peaceful-palettes).
const PRETTY = ['#86b9b0', '#8eaebb', '#afb4ad', '#b3cde4', '#bdd9cd', '#bed4e9', '#c4b3a9', '#ccb0be', '#cfcad1', '#d2e1cc', '#d6cfbf', '#d9ae8e',
  '#d9d7c2', '#dac4d0', '#daeaf7', '#e2c58d', '#e7c8e7', '#f7a49e', '#f7c6c2', '#fdefc0', '#ffddba', '#ffdf7c'];
const luminance = ([r, g, b]: RGB) => { const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
/** Black text on it has at least 7:1 contrast. */
const blackReadable = (hex: string) => luminance(hexRgb(hex)!) >= 0.3;

const STYLE_POOL = [...new Set([
  ...PRETTY,
  ...Array.from({ length: 60 }, (_, k) => k * 6).flatMap((h) => [0.3, 0.45, 0.6, 0.72].flatMap((s) => [0.79, 0.84, 0.89].map((l) => fromHsl(h, s, l)))),
])].filter((c) => blackReadable(c) && luminance(hexRgb(c)!) <= 0.82).map((hex) => ({ hex, lab: labOf(hex) }));

/**
 * `n` light, black-text-readable colors in the style of PRETTY, each at least `minEach` (CIEDE2000) from every other
 * suggestion and as far as possible (target `minExisting`) from `existing`. Random among near-best choices so shuffling varies.
 */
export function suggestColors(existing: string[], n = 4, minExisting = 10, minEach = 18): string[] {
  const ref = existing.map(hexRgb).filter((x): x is RGB => !!x).map(lab);
  const pool = STYLE_POOL.map((c) => ({ ...c, gap: Math.min(Infinity, ...ref.map((r) => dist(r, c.lab))) }));
  for (let tEx = minExisting; tEx >= 0; tEx -= 2)
    for (const tIn of [minEach, minEach - 4, minEach - 8]) {
      const cands = pool.filter((c) => c.gap >= tEx);
      if (cands.length < n) continue;
      for (let attempt = 0; attempt < 30; attempt++) {
        const out: typeof pool = [];
        let left = cands;
        while (out.length < n && left.length) {
          const score = (c: (typeof pool)[number]) => Math.min(c.gap, 2 * tIn, ...out.map((o) => dist(o.lab, c.lab)));
          const best = Math.max(...left.map(score)), near = out.length ? left.filter((c) => score(c) >= best * 0.75) : left;
          const pick = near[Math.floor(Math.random() * near.length)];
          out.push(pick);
          left = left.filter((c) => dist(c.lab, pick.lab) >= tIn);
        }
        if (out.length === n) return out.map((c) => c.hex).sort((a, b) => hsl(hexRgb(a)!)[0] - hsl(hexRgb(b)!)[0]);
      }
    }
  return pool.sort((a, b) => b.gap - a.gap).slice(0, n).map((c) => c.hex);
}

/** Default color for something new: one suggestion that stands apart from every color already in use (plus `extra`, e.g. unsaved drafts). */
export const defaultColor = (s: State, extra: string[] = []) => suggestColors([...usedColors(s), ...extra], 1)[0];
