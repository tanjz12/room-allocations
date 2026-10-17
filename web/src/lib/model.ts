import { useEffect, useState } from 'react';
import { evaluate } from './formula';

import { emptyConfig, mergeLegendExtras, type Config, type PillBound, type ProctorLine, type ProctorPill, type Proctors, type RoomMatch, type RoomSign } from './config';

/** Only rooms with status Yes are scheduled or counted. `typeAuto`: the type comes from the room type rules instead of being set by hand. */
export type Room = { id: string; name: string; building: string; type: string; typeAuto?: boolean; base: number | null; overrides: Record<string, number>; status?: string; sign?: RoomSign };
export const ROOM_STATUSES = ['Yes', 'Need to Request', 'Awaiting Approval', 'No'];
export const roomActive = (r: Room) => r.status === 'Yes';
export type EventT = { id: string; name: string; color: string; start: number; end: number; startRef: TimeRef | null; endRef: TimeRef | null; capacityType: string; group: string; signName?: string; signHide?: boolean; signFirst?: boolean };
/** Links an event time to the start or end of a phase's external schedule. */
export type TimeRef = { phaseId: string; edge: 'start' | 'end' };
/** `times` holds each phase schedule's start/end by schedule key; older data keeps External in start/end and Internal in intStart/intEnd. */
export type Phase = { id: string; name: string; color: string; start: number; end: number; intStart: number; intEnd: number; times?: Record<string, { start: number; end: number }> };
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
export type CapType = { id: string; name: string; formulas: Record<string, string> };
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
/** Recomputes linked event times from the phases; links to deleted phases become fixed times. */
export function applyPhaseRefs(s: State) {
  for (const e of s.events) {
    for (const k of ['start', 'end'] as const) {
      const ref = e[`${k}Ref`];
      if (!ref) continue;
      const p = s.phases.find((x) => x.id === ref.phaseId);
      if (p) e[k] = phaseTimes(p, s.config.alignSchedule ?? s.config.phaseSchedules?.[0]?.key ?? 'ext')[ref.edge];
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
  for (const c of out.categories) delete (c as Category & { hideOn?: unknown }).hideOn;
  if (!out.capTypes.some((c) => c.id === 'base')) out.capTypes.unshift(structuredClone(RAW_CAP));
  if (out.config.proctors) migrateProctors(out.config.proctors = structuredClone(out.config.proctors));
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

export const eventAt = (e: EventT, t: number) => e.start <= t && t < e.end;

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
  useEffect(() => { if (state.version) localStorage.setItem(KEY, JSON.stringify(state)); }, [state]);
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
export type ProcRoom = { r: Room; v: number };
export const proctorLabel = (half: string) => (half ? `${half} proctors` : 'Proctors');
export const procRooms = (state: State, roomIds: Iterable<string>, capId: string): ProcRoom[] =>
  [...new Set(roomIds)].map((id) => state.rooms.find((x) => x.id === id && roomActive(x))).filter((r) => !!r)
    .map((r) => ({ r, v: roomCapacity(state, r, capId).value ?? 0 }));
const boundTime = (state: State, b: PillBound | undefined, dflt: number) => {
  if (!b) return dflt;
  if ('time' in b) return b.time;
  const ph = state.phases.find((p) => p.id === b.phaseId);
  return ph ? ph[b.edge] : dflt;
};
/** Each proctor pill's slots and the proctors needed at its busiest slot, from the package's proctor rules. */
export function proctorPills(state: State) {
  const P = state.config.proctors;
  if (!P) return [];
  return P.pills.map((pill) => {
    const counted = state.events.filter((e) => e.group === pill.group && !pill.excludeIds.includes(e.id));
    const proctorsAt = (t: number, capId: string) => {
      const rooms = procRooms(state, state.blocks.filter((b) => counted.some((e) => e.id === b.eventId && eventAt(e, t))).map((b) => b.roomId), capId);
      return { n: rooms.reduce((n, x) => n + x.v, 0), rooms };
    };
    const peak = (slots: number[], capId: string) =>
      slots.map((t) => proctorsAt(t, capId)).reduce((best, x) => (x.n > best.n ? x : best), { n: 0, rooms: [] as ProcRoom[] });
    const from = boundTime(state, pill.from, -Infinity), to = boundTime(state, pill.to, Infinity);
    const slots = SLOTS.filter((t) => t >= from && t < to);
    return { pill, slots, min: peak(slots, P.minCap), ideal: peak(slots, P.idealCap) };
  });
}
type OldProctors = Proctors & { bigType?: string; group?: string; excludeIds?: string[]; splitPhaseId?: string; halves?: [string, string]; smallLabel?: string; rows?: { label: string; eventIds: string[] }[] };
/** "Large (Ana, Bo)" is room type Large. */
export const baseType = (t: string) => t.replace(/\s*\(.*$/, '') || t;
export const roomMatches = (r: Room, m: RoomMatch) =>
  m.field === 'room' ? r.id === m.value : m.field === 'type' ? r.type === m.value || baseType(r.type) === m.value : (r[m.field] ?? '') === m.value;
export const roomListed = (P: Proctors | undefined, r: Room) => !!P?.listed.some((m) => roomMatches(r, m));
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
  d.config.summaryEventIds = drop(d.config.summaryEventIds)!;
  for (const t of d.summaryTotals) if (t.eventIds?.includes(id)) delete t.eventIds;
  const P = d.config.proctors;
  P?.pills.forEach((p) => { p.excludeIds = drop(p.excludeIds)!; p.lines.forEach((l) => { l.eventIds = drop(l.eventIds)!; }); });
  for (const c of [...(d.config.sameColors ?? []), ...(d.config.colorOptions ?? []).flatMap((o) => o.colors)]) c.eventIds = drop(c.eventIds)!;
}
export const summaryRoomUsed = (state: State, x: SummaryTotal, roomId: string) =>
  !(x.eventIds?.length || x.eventGroups?.length) || state.blocks.some((b) => b.roomId === roomId
    && (x.eventIds?.includes(b.eventId) || !!x.eventGroups?.includes(state.events.find((e) => e.id === b.eventId)?.group ?? '\u0000')));
export const summaryTotalValue = (state: State, x: SummaryTotal) =>
  state.rooms.filter((r) => roomActive(r) && roomTags(state, r).some((y) => y.id === x.tagId) && summaryRoomUsed(state, x, r.id))
    .reduce((t, r) => t + (roomCapacity(state, r, x.capType).value ?? 0), 0);
