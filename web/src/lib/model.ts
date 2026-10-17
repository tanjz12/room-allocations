import { useEffect, useState } from 'react';
import { evaluate } from './formula';

import { emptyConfig, type Config, type RoomSign } from './config';

/** Only rooms with status Yes are scheduled or counted. */
export type Room = { id: string; name: string; building: string; type: string; base: number | null; overrides: Record<string, number>; status?: string; sign?: RoomSign };
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
/** `hideOn`: map names where this tag's rooms are left uncolored. */
export type Category = { id: string; name: string; color: string; internal: boolean; external: boolean; hideOn?: string[]; eventGroups?: string[]; eventMatch?: 'any' | 'all'; whenEmpty?: boolean };
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
export type SummaryTotal = { id: string; label: string; tagId: string; capType: string };
export type State = { rooms: Room[]; events: EventT[]; categories: Category[]; typeTags: Record<string, string[]>; mapColors: MapColors; blocks: Block[]; capTypes: CapType[]; phases: Phase[]; summaryTotals: SummaryTotal[]; projectedIndiv?: number; config: Config; version?: number };

export const DAY_START = 7 * 60;
export const DAY_END = 20 * 60;
export const SLOT = 15;
export const SLOTS: number[] = [];
for (let t = DAY_START; t < DAY_END; t += SLOT) SLOTS.push(t);
export const OTHER_GROUP = 'Other';
export const roomTypes = (s: State) => [...new Set([...s.config.roomTypes, ...s.rooms.map((r) => r.type)])];
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
  if (!out.capTypes.some((c) => c.id === 'base')) out.capTypes.unshift(structuredClone(RAW_CAP));
  applyPhaseRefs(out);
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

export function roomEventsAt(s: State, roomId: string, t: number): EventT[] {
  const out: EventT[] = [];
  const room = s.rooms.find((r) => r.id === roomId);
  if (!room || !roomActive(room)) return out;
  for (const b of s.blocks) {
    if (b.roomId !== roomId) continue;
    const e = s.events.find((x) => x.id === b.eventId);
    if (e && eventAt(e, t)) out.push(e);
  }
  return out;
}

export const overlaps = (a: EventT, b: EventT) => a.start < b.end && b.start < a.end;
const spaced = (s: State, e: EventT) => !!s.config.spacing?.eventIds.includes(e.id);
export function clashWith(s: State, a: EventT, b: EventT): 'overlap' | 'gap' | null {
  if (overlaps(a, b)) return 'overlap';
  const gap = s.config.spacing?.minutes ?? 0;
  if (gap && (spaced(s, a) || spaced(s, b)) && a.start < b.end + gap && b.start < a.end + gap) return 'gap';
  return null;
}
export const clashMessage = (s: State, verb: string, n: EventT, room: string, c: EventT) => {
  const t = (e: EventT) => `${e.name} ${fmtTime(e.start)}–${fmtTime(e.end)}`;
  return clashWith(s, n, c) === 'gap'
    ? `Can't ${verb} ${t(n)}: ${s.config.spacing?.label ?? 'these events'} need ${s.config.spacing?.minutes} minutes between events, and ${room} has ${t(c)}.`
    : `Can't ${verb} ${t(n)}: ${room} already has ${t(c)}.`;
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
    setState((prev) => { const d = structuredClone(prev); fn(d); return d; });
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
/** Proctors needed at the busiest slot before and after the split phase, from the package's proctor rules. */
export function proctorHalves(state: State) {
  const P = state.config.proctors;
  if (!P) return [];
  const split = state.phases.find((p) => p.id === P.splitPhaseId);
  const testing = state.events.filter((e) => e.group === P.group && !P.excludeIds.includes(e.id));
  const proctorsAt = (t: number, capId: string) => {
    const rooms = procRooms(state, state.blocks.filter((b) => testing.some((e) => e.id === b.eventId && eventAt(e, t))).map((b) => b.roomId), capId);
    return { n: rooms.reduce((n, x) => n + x.v, 0), rooms };
  };
  const peak = (slots: number[], capId: string) =>
    slots.map((t) => proctorsAt(t, capId)).reduce((best, x) => (x.n > best.n ? x : best), { n: 0, rooms: [] as ProcRoom[] });
  return (P.halves ? [
    { label: P.halves[0], first: true, slots: SLOTS.filter((t) => t < (split?.start ?? 720)) },
    { label: P.halves[1], first: false, slots: SLOTS.filter((t) => t >= (split?.end ?? 720)) },
  ] : [{ label: '', first: false, slots: SLOTS }]).map((h) => ({ ...h, min: peak(h.slots, P.minCap), ideal: peak(h.slots, P.idealCap) }));
}
export const summaryTotalValue = (state: State, x: SummaryTotal) =>
  state.rooms.filter((r) => roomActive(r) && roomTags(state, r).some((y) => y.id === x.tagId))
    .reduce((t, r) => t + (roomCapacity(state, r, x.capType).value ?? 0), 0);
