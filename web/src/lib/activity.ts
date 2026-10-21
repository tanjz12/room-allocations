import { fmtTime, type State } from './model';

export type Activity = { at: string; by: string; text: string; key?: string; from?: string; to?: string };
const MAX = 2000;
const MERGE_MS = 2 * 60_000;

type Snap = Pick<State, 'rooms' | 'blocks' | 'events' | 'phases' | 'capTypes' | 'categories' | 'summaryTotals' | 'typeTags' | 'mapColors'> & { config: Record<string, string> };
type Change = { key: string; text: string; from?: string; to?: string };

/** The parts of the state the log compares (config is compared key by key, without the large package pages). */
export function snapshot(s: State): Snap {
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.config)) if (k !== 'pages' && k !== 'drive') config[k] = JSON.stringify(v ?? null);
  const pages = (s.config as { pages?: { name?: string }[] }).pages;
  if (pages) config.pages = JSON.stringify(pages.map((p) => p.name ?? ''));
  return structuredClone({ rooms: s.rooms, blocks: s.blocks, events: s.events, phases: s.phases, capTypes: s.capTypes, categories: s.categories, summaryTotals: s.summaryTotals, typeTags: s.typeTags, mapColors: s.mapColors, config });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const show = (v: unknown) => (v == null || v === '' ? '(blank)' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

function diffList<T extends { id: string; name?: string }>(kind: string, a: T[], b: T[], out: Change[], fields: (x: T, y: T) => void) {
  const A = byId(a), B = byId(b);
  for (const y of b) { const x = A.get(y.id); if (!x) out.push({ key: `${kind}:${y.id}:add`, text: `added ${kind} ${y.name || y.id}` }); else if (!same(x, y)) fields(x, y); }
  for (const x of a) if (!B.has(x.id)) out.push({ key: `${kind}:${x.id}:del`, text: `deleted ${kind} ${x.name || x.id}` });
}

export function describe(a: Snap, b: Snap): Change[] {
  const out: Change[] = [];
  const room = (s: Snap, id: string) => s.rooms.find((r) => r.id === id)?.name ?? id;
  const ev = (s: Snap, id: string) => s.events.find((e) => e.id === id)?.name ?? id;
  const cap = (id: string) => b.capTypes.find((c) => c.id === id)?.name ?? a.capTypes.find((c) => c.id === id)?.name ?? id;
  const field = (key: string, label: string, x: unknown, y: unknown, fmt: (v: unknown) => string = show) => {
    if (!same(x, y)) out.push({ key, text: label, from: fmt(x), to: fmt(y) });
  };
  const time = (v: unknown) => (typeof v === 'number' ? fmtTime(v) : show(v));

  const A = byId(a.blocks), B = byId(b.blocks);
  for (const y of b.blocks) {
    const x = A.get(y.id);
    if (!x) out.push({ key: `block:${y.id}:add`, text: `added ${ev(b, y.eventId)} to ${room(b, y.roomId)}` });
    else if (x.roomId !== y.roomId || x.eventId !== y.eventId) out.push({ key: `block:${y.id}:move`, text: `changed ${ev(a, x.eventId)} in ${room(a, x.roomId)} to ${ev(b, y.eventId)} in ${room(b, y.roomId)}` });
    else if (!same(x, y)) out.push({ key: `block:${y.id}:edit`, text: `edited ${ev(b, y.eventId)} block in ${room(b, y.roomId)}` });
  }
  for (const x of a.blocks) if (!B.has(x.id)) out.push({ key: `block:${x.id}:del`, text: `removed ${ev(a, x.eventId)} from ${room(a, x.roomId)}` });

  diffList('room', a.rooms, b.rooms, out, (x, y) => {
    for (const f of ['name', 'building', 'type', 'status'] as const) field(`room:${y.id}:${f}`, `${y.name} ${f === 'type' ? 'room type' : f}`, x[f], y[f]);
    field(`room:${y.id}:base`, `${y.name} [Raw] capacity`, x.base, y.base);
    for (const c of new Set([...Object.keys(x.overrides ?? {}), ...Object.keys(y.overrides ?? {})]))
      field(`room:${y.id}:ov:${c}`, `${y.name} ${cap(c)} override`, x.overrides?.[c], y.overrides?.[c], (v) => (v == null ? '(formula)' : String(v)));
    if (!same(x.sign, y.sign)) out.push({ key: `room:${y.id}:sign`, text: `edited ${y.name} sign` });
  });
  diffList('event', a.events, b.events, out, (x, y) => {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)]) as Set<keyof typeof y>) {
      if (k === 'id' || same(x[k], y[k])) continue;
      if (k === 'start' || k === 'end') field(`event:${y.id}:${k}`, `${y.name} ${k}`, x[k], y[k], time);
      else if (k === 'capacityType') field(`event:${y.id}:${k}`, `${y.name} capacity type`, cap(String(x[k])), cap(String(y[k])));
      else if (typeof x[k] === 'object' || typeof y[k] === 'object') out.push({ key: `event:${y.id}:${k}`, text: `edited ${y.name} ${k === 'startRef' ? 'start link' : k === 'endRef' ? 'end link' : k}` });
      else field(`event:${y.id}:${k}`, `${y.name} ${k === 'name' ? 'name' : k}`, x[k], y[k]);
    }
  });
  diffList('phase', a.phases, b.phases, out, (x, y) => {
    if (x.name !== y.name) field(`phase:${y.id}:name`, 'phase name', x.name, y.name);
    else out.push({ key: `phase:${y.id}:edit`, text: `edited phase ${y.name}` });
  });
  diffList('capacity type', a.capTypes, b.capTypes, out, (x, y) => {
    for (const t of new Set([...Object.keys(x.formulas), ...Object.keys(y.formulas)])) field(`cap:${y.id}:f:${t}`, `${y.name} formula for ${t}`, x.formulas[t], y.formulas[t]);
    for (const k of Object.keys({ ...x, ...y }) as (keyof typeof y)[]) if (k !== 'formulas' && k !== 'id') field(`cap:${y.id}:${k}`, `${y.name} ${k === 'addMin' ? 'Min to add' : k}`, x[k], y[k]);
  });
  diffList('event group', a.categories, b.categories, out, (_x, y) => out.push({ key: `cat:${y.id}:edit`, text: `edited event group ${y.name || y.id}` }));
  if (!same(a.summaryTotals, b.summaryTotals)) out.push({ key: 'summary', text: 'edited summary settings' });
  if (!same(a.typeTags, b.typeTags)) out.push({ key: 'typeTags', text: 'edited room type tags' });
  if (!same(a.mapColors, b.mapColors)) out.push({ key: 'mapColors', text: 'edited map colors' });
  for (const k of new Set([...Object.keys(a.config), ...Object.keys(b.config)])) if (a.config[k] !== b.config[k]) out.push({ key: `config:${k}`, text: `edited settings (${k})` });
  return out;
}

/** Appends the changes to state.activity; repeated edits of the same value by the same person within 2 minutes become one entry. */
export function record(s: State, changes: Change[], by: string, now = new Date()) {
  if (!changes.length) return;
  const log = (s.activity ??= []);
  for (const c of changes) {
    const last = [...log].reverse().find((e) => e.key === c.key);
    if (last && c.from !== undefined && last.by === by && last === log[log.length - 1] && now.getTime() - Date.parse(last.at) < MERGE_MS) {
      last.to = c.to; last.at = now.toISOString();
      if (last.from === last.to) log.pop();
      continue;
    }
    log.push({ at: now.toISOString(), by, ...c });
  }
  if (log.length > MAX) log.splice(0, log.length - MAX);
}

export const activityText = (e: Activity) => (e.from !== undefined || e.to !== undefined ? `${e.text}: ${e.from ?? '(blank)'} → ${e.to ?? '(blank)'}` : e.text);
