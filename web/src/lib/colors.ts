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
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

/** Colors around the typical saturation/lightness of `existing`, spread over the hue wheel and kept away from the existing colors. */
export function suggestColors(existing: string[], n = 12): string[] {
  const rgbs = existing.map(hexRgb).filter((x): x is RGB => !!x);
  const styles = rgbs.map(hsl).filter(([, s]) => s > 0.12);
  if (!styles.length) styles.push([0, 0.55, 0.62]);
  const med = (k: number) => { const v = styles.map((x) => x[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const [s0, l0] = [med(1), med(2)];
  const ref = rgbs.map(lab), out: { hex: string; lab: number[] }[] = [];
  const offset = Math.random() * 360;
  for (let k = 0; k < n; k++) {
    let best: (typeof out)[number] | null = null, bestGap = -1;
    for (let tries = 0; tries < 40 && bestGap < 14; tries++) {
      const hex = fromHsl((offset + (k * 360) / n + (Math.random() - 0.5) * 24 + 360) % 360,
        clamp(s0 + (Math.random() - 0.5) * 0.16, 0.15, 1), clamp(l0 + (Math.random() - 0.5) * 0.14, 0.25, 0.92));
      const c = { hex, lab: lab(hexRgb(hex)!) };
      const g = Math.min(Infinity, ...ref.map((r) => dist(r, c.lab)), ...out.map((o) => dist(o.lab, c.lab)));
      if (g > bestGap) { bestGap = g; best = c; }
    }
    out.push(best!);
  }
  return out.map((c) => c.hex).sort((a, b) => hsl(hexRgb(a)!)[0] - hsl(hexRgb(b)!)[0]);
}
