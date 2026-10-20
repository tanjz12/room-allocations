import { useEffect, useState } from 'react';
import { evaluate } from './formula';

import { DEFAULT_ROOM_STATUSES, emptyConfig, mergeLegendExtras, type Config, type PillBound, type ProctorLine, type ProctorPill, type Proctors, type RoomSign, type SummaryRow } from './config';

/** Only rooms with status Yes are scheduled or counted. `typeAuto`: the type comes from the room type rules instead of being set by hand. */
export type Room = { id: string; name: string; building: string; type: string; typeAuto?: boolean; base: number | null; overrides: Record<string, number>; status?: string; sign?: RoomSign };
export const roomStatuses = (s: State) => s.config.roomStatuses ?? DEFAULT_ROOM_STATUSES;
export const roomActive = (r: Room) => r.status === 'Yes';
export type EventT = { id: string; name: string; color: string; start: number; end: number; startRef: TimeRef | null; endRef: TimeRef | null; capacityType: string; group: string; signName?: string; signHide?: boolean; signFirst?: boolean };
/** Links an event time to the start or end of a phase's external schedule. */
export type TimeRef = { phaseId: string; edge: 'start' | 'end' };
/** `times` holds each phase schedule's start/end by schedule key; older data keeps External in start/end and Internal in intStart/intEnd. */
export type Phase = { scheds?: string[]; id: string; name: string; color: string; start: number; end: number; intStart: number; intEnd: number; times?: Record<string, { start: number; end: number }> };
export function phaseTimes(p: Phase, key: string): { start: number; end: number } {
  return p.times?.[key] ?? (key === 'int' ? { start: p.intStart, end: p.intEnd } : { start: p.start, end: p.end });
}
export type Category = { id: string; name: string; color: string; internal: boolean; external: boolean; eventGroups?: string[]; eventMatch?: 'any' | 'all'; whenEmpty?: boolean };
/** Tags are stored as `categories` and assigned per room type in `typeTags`. A tag with `eventGroups` applies only when all
 * (or, with `eventMatch: 'any'`, any) of the room's scheduled events are in those groups; with nothing scheduled, only if `whenEmpty`. */
export const roomTags = (s: State, r: Room) => {
  const groups = s.blocks.filter((b) => b.roomId === r.id).map((b) => s.events.find((e) => e.id === b.eventId)?.group ?? '');
  const fits = (c: Category) => !c.eventGroups?.length || (!groups.length ? !!c.whenEmpty : c.eventMatch === 'any' ? groups.some((g) => c.eventGroups!.includes(g)) : groups.every((g) => c.eventGroups!.includes(g)));
  return (s.typeTags[r.type] ?? []).map((id) => s.categories.find((c) => c.id === id)).filter((c): c is Category => !!c && fits(c));
};
/** `signName` overrides the event's sign label for this room only. */
export type Block = { id: string; roomId: string; eventId: string; signName?: string };
export type CapType = { id: string; name: string; formulas: Record<string, string>; /** Set (even to null) by the data package to show "Min to add" for this type. */ addMin?: number | null };
/** `eventIds` / `eventGroups`: count only rooms with one of these events (or an event in one of these groups) scheduled. */
export type SummaryTotal = { id: string; label: string; tagId: string; capType: string; eventIds?: string[]; eventGroups?: string[] };
export type State = { rooms: Room[]; events: EventT[]; categories: Category[]; typeTags: Record<string, string[]>; mapColors: MapColors; blocks: Block[]; capTypes: CapType[]; phases: Phase[]; summaryTotals: SummaryTotal[]; projectedIndiv?: number; config: Config; version?: number };

export const DAY_START = 7 * 60;
export const DAY_END = 20 * 60;
export const SLOT = 15;
export const SLOTS: number[] = [];
for (let t = DAY_START; t < DAY_END; t += SLOT) SLOTS.push(t);
export const OTHER_GROUP = 'Other';
export const roomTypes = (s: State) => [...new Set([...s.config.roomTypes, ...s.rooms.map((r) => r.type)])];
/** The type the room type rules give a room: the first type whose condition holds for its [Raw]. */
export function ruleType(s: State, r: Room): { type?: string; error?: string } {
  if (r.base == null) return { error: `Room has no ${RAW_NAME} capacity` };
  for (const t of roomTypes(s)) {
    const expr = s.config.typeRules?.[t]?.trim();
    if (!expr) continue;
    try {
      if (evaluate(expr, (name) => { if (name === RAW_NAME || name === 'base') return r.base!; throw new Error(`Unknown variable ${name}`); })) return { type: t };
    } catch (e) { return { error: `${t}: ${(e as Error).message}` }; }
  }
  return { error: 'No rule matches' };
}
export function applyTypeRules(s: State) {
  for (const r of s.rooms) if (r.typeAuto) { const t = ruleType(s, r).type; if (t) r.type = t; }
}
export const eventGroups = (s: State) => [...new Set([...s.config.eventGroups, OTHER_GROUP])];

export const fmtTime = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function textColor(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff';
}

export const RAW_NAME = '[Raw]';
export const STATE_VERSION = 22;
export const isSub = (s: State, e: EventT) => !!s.config.subgroup?.eventIds.includes(e.id);
export function groupedEvents(s: State, keepEmpty = false) {
  const groups = eventGroups(s);
  const order = s.config.eventOrder;
  const rank = (e: EventT) => { const i = order.indexOf(e.id); return i < 0 ? 1000 : i; };
  return groups.map((g) => ({
    group: g,
    events: s.events.filter((e) => (groups.includes(e.group) ? e.group : OTHER_GROUP) === g)
      .sort((a, b) => rank(a) - rank(b) || a.start - b.start || a.name.localeCompare(b.name)),
  })).filter((x) => keepEmpty || x.events.length);
}
export const alignKey = (s: State) => s.config.alignSchedule ?? s.config.phaseSchedules?.[0]?.key ?? 'ext';
/** Whether a phase shows in a schedule; phases without `scheds` show in all of them. */
export const inSched = (p: Phase, key: string) => !p.scheds || p.scheds.includes(key);
export const alignPhases = (s: State) => s.phases.filter((p) => inSched(p, alignKey(s)));
/** Recomputes linked event times from the phases; links to deleted phases become fixed times. */
export function applyPhaseRefs(s: State) {
  for (const e of s.events) {
    for (const k of ['start', 'end'] as const) {
      const ref = e[`${k}Ref`];
      if (!ref) continue;
      const p = s.phases.find((x) => x.id === ref.phaseId);
      if (p) e[k] = phaseTimes(p, alignKey(s))[ref.edge];
      else e[`${k}Ref`] = null;
    }
  }
}
export const refLabel = (s: State, r: TimeRef) => {
  const p = s.phases.find((x) => x.id === r.phaseId);
  return p ? `${r.edge === 'start' ? 'Start' : 'End'} of ${p.name}` : '';
};

export type MapColors = { unused: string; unknown: string; other: string; focusUnused: string };
export const DEFAULT_MAP_COLORS: MapColors = { unused: '#dcdcdc', unknown: '#ffffff', other: '#424242', focusUnused: '#9ef01a' };
const RAW_CAP: CapType = { id: 'base', name: RAW_NAME, formulas: {} };

/** Fills in anything missing so files from any source load safely. */
export function normalize(s: Partial<State>): State {
  const d = initialState();
  const out: State = { ...d, ...s, config: { ...emptyConfig(), ...(s.config ?? {}) }, mapColors: { ...DEFAULT_MAP_COLORS, ...(s.mapColors ?? {}) } } as State;
  for (const k of ['rooms', 'events', 'categories', 'blocks', 'capTypes', 'phases', 'summaryTotals'] as const) if (!Array.isArray(out[k])) (out as Record<string, unknown>)[k] = [];
  out.typeTags ??= {};
  const cfg = out.config as Config & { mapGroupColor?: { group: string; color: string }; mapGroupColors?: { group: string; color: string }[] };
  const oldGc = [...(cfg.mapGroupColor ? [cfg.mapGroupColor] : []), ...(cfg.mapGroupColors ?? [])].filter((g) => g.group);
  if (oldGc.length && !cfg.sameColors?.length) cfg.sameColors = oldGc.map((g, i) => ({ id: `sc${i + 1}`, name: '', color: g.color, groups: [g.group], eventIds: [] }));
  delete cfg.mapGroupColor; delete cfg.mapGroupColors;
  delete (cfg as Config & { spacing?: unknown }).spacing;
  mergeLegendExtras(cfg);
  const sts = (cfg.roomStatuses ??= structuredClone(DEFAULT_ROOM_STATUSES));
  for (const r of out.rooms) if (r.status && !sts.some((x) => x.name === r.status)) sts.push({ name: r.status, color: '#9e9e9e' });
  for (const c of out.categories) delete (c as Category & { hideOn?: unknown }).hideOn;
  if (!out.capTypes.some((c) => c.id === 'base')) out.capTypes.unshift(structuredClone(RAW_CAP));
  if (out.config.proctors) migrateProctors(out.config.proctors = structuredClone(out.config.proctors));
  migrateSummary(out);
  applyPhaseRefs(out);
  applyTypeRules(out);
  out.version = STATE_VERSION;
  return out;
}

/** An empty, generic app: no rooms, events, tags, rules or floor plans until a data package is opened. */
export function initialState(): State {
  return {
    rooms: [], events: [], phases: [], blocks: [], capTypes: [structuredClone(RAW_CAP)], categories: [], typeTags: {},
    mapColors: { ...DEFAULT_MAP_COLORS }, summaryTotals: [], config: emptyConfig(), version: STATE_VERSION,
  };
}

export type CapResult = { value: number | null; source: 'override' | 'formula' | 'none'; error?: string };

export function roomCapacity(s: State, room: Room, capId: string, seen: string[] = []): CapResult {
  if (room.overrides[capId] !== undefined) return { value: room.overrides[capId], source: 'override' };
  const ct = s.capTypes.find((c) => c.id === capId);
  const expr = ct?.formulas[room.type]?.trim();
  if (!expr) return { value: null, source: 'none' };
  if (seen.includes(capId)) return { value: null, source: 'none', error: `Circular reference: ${[...seen, capId].join(' → ')}` };
  try {
    const v = evaluate(expr, (name) => {
      if (name === RAW_NAME || name === 'base') {
        if (room.base == null) throw new Error(`Room has no ${RAW_NAME} capacity`);
        return room.base;
      }
      const ref = s.capTypes.find((c) => c.id === name || `[${c.name}]` === name);
      if (!ref) throw new Error(`Unknown variable ${name}`);
      const r = roomCapacity(s, room, ref.id, [...seen, capId]);
      if (r.error) throw new Error(r.error);
      if (r.value == null) throw new Error(`${name} undefined for this room`);
      return r.value;
    });
    return { value: Math.round(v * 100) / 100, source: 'formula' };
  } catch (e) {
    return { value: null, source: 'none', error: (e as Error).message };
  }
}

/** Whether an event overlaps the 15-minute slot starting at `t`. */
export const eventAt = (e: EventT, t: number) => e.start < t + SLOT && t < e.end;

/** Events in an active room at time `t`; with `t` null, all of its events for the day in time order. */
export function roomEventsAt(s: State, roomId: string, t: number | null): EventT[] {
  const out: EventT[] = [];
  const room = s.rooms.find((r) => r.id === roomId);
  if (!room || !roomActive(room)) return out;
  for (const b of s.blocks) {
    if (b.roomId !== roomId) continue;
    const e = s.events.find((x) => x.id === b.eventId);
    if (e && (t === null || eventAt(e, t))) out.push(e);
  }
  return t === null ? out.sort((a, b) => a.start - b.start) : out;
}

export const overlaps = (a: EventT, b: EventT) => a.start < b.end && b.start < a.end;
export function clashWith(_s: State, a: EventT, b: EventT): 'overlap' | null {
  return overlaps(a, b) ? 'overlap' : null;
}
export const clashMessage = (_s: State, verb: string, n: EventT, room: string, c: EventT) => {
  const t = (e: EventT) => `${e.name} ${fmtTime(e.start)}–${fmtTime(e.end)}`;
  return `Can't ${verb} ${t(n)}: ${room} already has ${t(c)}.`;
};

const KEY = 'room-alloc-v2';
export function useAppState() {
  const [state, setState] = useState<State>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw) as State);
    } catch { /* fall through */ }
    return initialState();
  });
  useEffect(() => { if (state.version) try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* over the browser's storage limit: the state lives on in memory and on Drive */ } }, [state]);
  const update = (fn: (draft: State) => void) =>
    setState((prev) => { const d = structuredClone(prev); fn(d); applyTypeRules(d); mergeLegendExtras(d.config); return d; });
  return { state, setState, update };
}
export type Updater = (fn: (draft: State) => void) => void;

export function eventTotals(state: State) {
  return state.events.map((e) => ({
    e,
    total: state.blocks.filter((b) => b.eventId === e.id).reduce((s, b) => {
      const r = state.rooms.find((x) => x.id === b.roomId && roomActive(x));
      return s + (r ? roomCapacity(state, r, e.capacityType).value ?? 0 : 0);
    }, 0),
  }));
}
/** Totals for the Floor plans highlight set, lead event first, then most seats first. */
export function highlightTotals(state: State) {
  const h = state.config.highlight;
  if (!h) return null;
  const rows = eventTotals(state);
  const items = h.eventIds.map((id) => rows.find((x) => x.e.id === id)).filter((x) => !!x)
    .sort((a, b) => (a.e.id === h.leadId ? -1 : 0) - (b.e.id === h.leadId ? -1 : 0) || b.total - a.total || a.e.name.localeCompare(b.e.name));
  return { items, total: items.reduce((a, x) => a + x.total, 0) };
}
export const proctorLabel = (half: string) => (half ? `${half} proctors` : 'Proctors');
/** Events of `group` starting inside the phase: the ones a proctors summary row counts. */
export const phaseEvents = (s: State, ph: Phase, group: string) => {
  const t = phaseTimes(ph, alignKey(s));
  return s.events.filter((e) => e.group === group && t.start <= e.start && e.start < t.end);
};
export const typeMatches = (r: Room, t: string) => r.type === t || baseType(r.type) === t;
const capSum = (s: State, rooms: Room[], capId: string | undefined) =>
  capId ? Math.round(rooms.reduce((n, r) => n + (roomCapacity(s, r, capId).value ?? 0), 0) * 100) / 100 : 0;
/** A summary row's number (for proctors: `n` is min, plus `ideal`) and the active rooms it counts. */
export function summaryValue(s: State, x: SummaryRow): { n: number; pills?: number[]; rooms: Room[]; phases?: { ph: Phase; rooms: Room[] }[] } {
  const active = s.rooms.filter(roomActive);
  const used = (ids: Set<string>) => { const u = new Set(s.blocks.filter((b) => ids.has(b.eventId)).map((b) => b.roomId)); return active.filter((r) => u.has(r.id)); };
  if (x.kind === 'cap') {
    const tagged = (r: Room) => { const ids = new Set(roomTags(s, r).map((c) => c.id)); return (x.tags ?? []).some((t) => ids.has(t)); };
    const usedFor = (r: Room) => !x.group || s.blocks.some((b) => b.roomId === r.id && s.events.find((e) => e.id === b.eventId)?.group === x.group);
    const rooms = active.filter((r) => (x.types.some((t) => typeMatches(r, t)) || tagged(r)) && usedFor(r));
    return { n: capSum(s, rooms, x.capType), rooms };
  }
  if (x.kind === 'event') {
    const rooms = used(new Set([x.eventId]));
    return { n: capSum(s, rooms, s.events.find((e) => e.id === x.eventId)?.capacityType), rooms };
  }
  const phases = x.phaseIds.map((id) => s.phases.find((p) => p.id === id)).filter((p) => !!p)
    .map((ph) => ({ ph, rooms: used(new Set(phaseEvents(s, ph, x.group).map((e) => e.id))) }));
  const pills = (s.config.proctorCaps?.pills ?? []).map((p) => Math.max(0, ...phases.map((q) => capSum(s, q.rooms, p.capType))));
  return { n: pills[0] ?? 0, pills, rooms: [...new Set(phases.flatMap((q) => q.rooms))], phases };
}
/** Turns old summary totals, event totals and proctor pills into summary rows. */
function migrateSummary(out: State) {
  const cfg = out.config;
  if (!cfg.summary?.length && (out.summaryTotals.length || cfg.summaryEventIds?.length || cfg.proctors)) {
    const rows: SummaryRow[] = out.summaryTotals.map((t) => ({ id: t.id, kind: 'cap', label: t.label, capType: t.capType,
      types: [], tags: [t.tagId], group: t.eventGroups?.[0] }));
    for (const id of cfg.summaryEventIds ?? []) {
      const e = out.events.find((x) => x.id === id);
      if (e) rows.push({ id: uid('sum'), kind: 'event', label: e.name, eventId: id });
    }
    const P = cfg.proctors;
    if (P) {
      cfg.proctorCaps = { pills: [{ capType: P.minCap, name: 'min' }, { capType: P.idealCap, name: 'ideal' }], listed: (P.listed ?? []).filter((m) => m.field === 'type').map((m) => m.value) };
      for (const g of new Set(P.pills.map((p) => p.group))) {
        const skip = P.pills.filter((p) => p.group === g).flatMap((p) => p.excludeIds);
        for (const ph of alignPhases(out)) if (phaseEvents(out, ph, g).some((e) => !skip.includes(e.id)))
          rows.push({ id: uid('sum'), kind: 'proctors', label: `${ph.name} proctors`, phaseIds: [ph.id], group: g });
      }
    }
    cfg.summary = rows;
  }
  cfg.summary ??= [];
  for (const x of cfg.summary) if (x.kind === 'proctors' && !x.phaseIds) { const o = x as { phaseId?: string }; x.phaseIds = o.phaseId ? [o.phaseId] : []; delete o.phaseId; }
  delete cfg.summaryEventIds; delete cfg.proctors; out.summaryTotals = [];
}
type OldProctors = Proctors & { bigType?: string; group?: string; excludeIds?: string[]; splitPhaseId?: string; halves?: [string, string]; smallLabel?: string; rows?: { label: string; eventIds: string[] }[] };
/** "Large (Ana, Bo)" is room type Large. */
export const baseType = (t: string) => t.replace(/\s*\(.*$/, '') || t;
/** Turns the old morning/afternoon proctor settings (one event group for all) into pills. */
export function migrateProctors(P: OldProctors) {
  const group = P.group ?? '', excludeIds = P.excludeIds ?? [];
  if (!Array.isArray(P.pills)) {
    const at = (edge: 'start' | 'end'): PillBound => (P.splitPhaseId ? { phaseId: P.splitPhaseId, edge } : { time: 720 });
    const pill = (name: string, lines: ProctorLine[]): ProctorPill => ({ id: uid('pill'), name, group, excludeIds: [...excludeIds], lines });
    P.pills = P.halves ? [
      { ...pill(proctorLabel(P.halves[0]), P.rows?.length ? P.rows.map((r) => ({ label: r.label, eventIds: r.eventIds })) : [{ label: '', eventIds: [] }]), to: at('start') },
      { ...pill(proctorLabel(P.halves[1]), [{ label: '', eventIds: [] }]), from: at('end') },
    ] : [pill('Proctors', [
      { label: P.smallLabel ?? 'Classrooms', eventIds: [], rooms: 'others' },
      ...(P.bigType ? [{ label: P.bigType, eventIds: [], rooms: 'listed' as const }] : []),
    ])];
  }
  for (const p of P.pills) { p.group ??= group; p.excludeIds ??= [...excludeIds]; }
  if (!Array.isArray(P.listed)) P.listed = P.bigType ? [{ field: 'type', value: P.bigType }] : [];
  delete P.bigType; delete P.group; delete P.excludeIds; delete P.splitPhaseId; delete P.halves; delete P.smallLabel; delete P.rows;
}
/** Drops a deleted event from the summary settings. */
export function forgetEvent(d: State, id: string) {
  const drop = (ids?: string[]) => ids?.filter((x) => x !== id);
  d.config.summary = d.config.summary?.filter((x) => !(x.kind === 'event' && x.eventId === id));
  for (const c of [...(d.config.sameColors ?? []), ...(d.config.colorOptions ?? []).flatMap((o) => o.colors)]) c.eventIds = drop(c.eventIds)!;
}
