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
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
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
  ];
  return [...new Set(cs.filter(Boolean).map((c) => c.toLowerCase()))];
}

// Light colors from Paper Heart Design's "Peaceful Palettes" (paperheartdesign.com/blog/color-palette-peaceful-palettes).
const PRETTY = ['#86b9b0', '#8eaebb', '#afb4ad', '#b3cde4', '#bdd9cd', '#bed4e9', '#c4b3a9', '#ccb0be', '#cfcad1', '#d2e1cc', '#d6cfbf', '#d9ae8e',
  '#d9d7c2', '#dac4d0', '#daeaf7', '#e2c58d', '#e7c8e7', '#f7a49e', '#f7c6c2', '#fdefc0', '#feb640', '#ffddba', '#ffdf7c'];
const luminance = ([r, g, b]: RGB) => { const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
/** Black text on it has at least 7:1 contrast. */
const blackReadable = (hex: string) => luminance(hexRgb(hex)!) >= 0.3;

/** Light, black-text-readable colors in the style of PRETTY (plus small hue shifts of them), kept away from `existing`, one hue family at a time. */
export function suggestColors(existing: string[], n = 9): string[] {
  const ref = existing.map(hexRgb).filter((x): x is RGB => !!x).map(lab);
  const pool = [...new Set(PRETTY.flatMap((c) => {
    const [h, s, l] = hsl(hexRgb(c)!);
    return [c, ...[-16, -8, 8, 16].map((d) => {
      let L = l, out = fromHsl((h + d + 360) % 360, s, L);
      while (!blackReadable(out) && L < 0.95) out = fromHsl((h + d + 360) % 360, s, (L += 0.02));
      return out;
    })];
  }))].filter(blackReadable).map((hex) => ({ hex, lab: lab(hexRgb(hex)!) }));
  const gap = (c: (typeof pool)[number]) => Math.min(Infinity, ...ref.map((r) => dist(r, c.lab)));
  let cands = pool;
  for (const t of [10, 6, 3, 0]) { cands = pool.filter((c) => gap(c) >= t); if (cands.length >= n * 3) break; }
  const buckets = new Map<number, typeof pool>();
  for (const c of cands) {
    const [h, sat] = hsl(hexRgb(c.hex)!);
    const k = sat < 0.15 ? -1 : Math.floor(h / 30);
    buckets.set(k, [...(buckets.get(k) ?? []), c]);
  }
  const groups = [...buckets.values()].sort(() => Math.random() - 0.5);
  const out: typeof pool = [];
  const far = (c: (typeof pool)[number]) => Math.min(Infinity, ...out.map((x) => dist(x.lab, c.lab)));
  for (let round = 0; out.length < n && round < 6; round++)
    for (const g of groups) {
      if (out.length >= n || !g.length) continue;
      const i = round ? g.reduce((b, c, k) => (far(c) > far(g[b]) ? k : b), 0) : Math.floor(Math.random() * g.length);
      if (far(g[i]) >= 10) out.push(...g.splice(i, 1));
    }
  return out.map((c) => c.hex).sort((a, b) => hsl(hexRgb(a)!)[0] - hsl(hexRgb(b)!)[0]);
}
