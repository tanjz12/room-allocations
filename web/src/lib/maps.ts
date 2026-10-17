import type { Font } from 'opentype.js';
import { roomActive, roomEventsAt, roomTags, textColor, type EventT, type State } from './model';
import type { MapDef } from './config';
import { textPath } from './text';

export type ColorBy = 'event' | 'category';
export type Variant = 'app' | 'internal' | 'external';
export type Entry = { key: string; label: string; color: string };

const NS = 'http://www.w3.org/2000/svg';

// Prefix ids so several inlined maps don't resolve each other's clip paths, masks and glyphs.
export const scopeIds = (svg: string, p: string) =>
  svg.replace(/\bid="([^"]+)"/g, `id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/href="#([^"]+)"/g, `href="#${p}$1"`);
const scoped = new Map<string, string>();
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const scopedTemplate = (m: MapDef) => {
  const key = `${m.name}\u0000${m.svg.length}\u0000${m.svg.slice(0, 200)}`;
  if (!scoped.has(key)) scoped.set(key, scopeIds(m.svg, `${slug(m.name)}-`));
  return scoped.get(key)!;
};
export const mapRoomIds = (m: MapDef) => Object.keys(m.meta.rooms);
export const allMapRoomIds = (s: State) => new Set(s.config.maps.flatMap(mapRoomIds));
const roomLabel = (m: MapDef, id: string) => m.labels?.[id] ?? id.replace(/^[A-Z]+/, '');

/** What a room should show at time t (null = nothing scheduled / hidden in this variant). */
export function roomEntry(s: State, roomId: string, t: number, colorBy: ColorBy, variant: Variant, only?: (e: EventT) => boolean): Entry | null {
  const room = s.rooms.find((r) => r.id === roomId);
  const e = roomEventsAt(s, roomId, t).filter((x) => !only || only(x))[0];
  if (!room || !e) return null;
  const tags = roomTags(s, room);
  if (tags.length && tags.every((c) => c.hideOn?.includes(room.building))) return null;
  if (variant === 'external' && !tags.some((c) => c.external)) return null;
  if (variant === 'internal' && tags.length && !tags.some((c) => c.internal)) return null;
  const tag = tags[0];
  const entry = colorBy === 'category'
    ? (tag ? { key: tag.id, label: tag.name, color: tag.color } : { key: 'none', label: 'Untagged', color: '#999999' })
    : { key: e.id, label: e.name, color: e.color };
  return entry;
}

export function renderMap(map: MapDef, s: State, t: number, colorBy: ColorBy, variant: Variant, font: Font | null, only?: (e: EventT) => boolean, unknownFill?: string, otherFill?: string, unusedFill?: string) {
  const doc = new DOMParser().parseFromString(scopedTemplate(map), 'image/svg+xml');
  const keep = (id: string) => !!map.keepOrig?.includes(id);
  const svg = doc.documentElement;
  const entries = new Map<string, Entry>();
  const addPath = (d: string, fill: string, extra: Record<string, string> = {}) => {
    const p = doc.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', fill);
    for (const [k, v] of Object.entries(extra)) p.setAttribute(k, v);
    svg.appendChild(p);
    return p;
  };
  for (const el of Array.from(svg.querySelectorAll('[data-room]'))) {
    const id = el.getAttribute('data-room')!;
    const known = s.rooms.some((r) => r.id === id && roomActive(r));
    const entry = known ? roomEntry(s, id, t, colorBy, variant, only) : null;
    const m = map.meta.rooms[id]?.[0];
    let fill: string;
    let showLabel = true;
    if (!known && unknownFill) fill = unknownFill;
    else if (!entry && only && otherFill && roomEntry(s, id, t, colorBy, variant)) fill = otherFill;
    else if (entry) { fill = entry.color; entries.set(entry.key, entry); }
    else if (variant === 'external') { fill = keep(id) && m ? m.orig : map.floor; showLabel = false; }
    else fill = keep(id) && m ? m.orig : unusedFill ?? s.mapColors.unused;
    el.setAttribute('fill', fill);
    svg.querySelectorAll(`[data-room-under="${id}"]`).forEach((u) => u.setAttribute('fill', fill));
    svg.querySelectorAll(`[data-label="${id}"]`).forEach((g) => {
      if (showLabel) g.setAttribute('fill', textColor(fill)); else g.setAttribute('display', 'none');
    });
    if (font && m?.added && showLabel) {
      const [x, y, w, h] = m.box;
      const label = roomLabel(map, id);
      const { d } = textPath(font, label, x + w / 2, y + h / 2 + 12, 35, w - 10, 'middle');
      addPath(d, textColor(fill), { 'data-label': id });
    }
  }
  svg.querySelectorAll('[data-legend]').forEach((el) => el.remove());
  if (font) {
    const L = map.meta.legend;
    const list = [...[...entries.values()].sort((a, c) => a.label.localeCompare(c.label)), ...(map.legendExtra ?? [])];
    const n = list.length;
    const step = n > map.legendSlots ? (L.step * map.legendSlots) / n : L.step;
    const h = step * (L.h / L.step);
    const size = Math.min(50, h * 0.64);
    list.forEach((e, i) => {
      const y = L.y + i * step;
      addPath(`M${L.x} ${y}h${L.w}v${h}h${-L.w}Z`, e.color, { 'data-legend-new': '1' });
      const { d } = textPath(font, e.label, L.x + 16, y + h / 2 + size * 0.36, size, L.w - 28);
      addPath(d, textColor(e.color), { 'data-legend-new': '1' });
    });
  }
  svg.querySelectorAll('[data-dot="1"]').forEach((d) => d.remove());
  return { svg: new XMLSerializer().serializeToString(svg), entries: [...entries.values()], width: map.meta.width, height: map.meta.height };
}

/** Strips scripts and event handlers from an SVG that will be inlined into the page. */
export function sanitizeSvg(text: string) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return text.replace(/<script[\s\S]*?<\/script>/gi, '');
  doc.querySelectorAll('script, foreignObject').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || (/href$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}
