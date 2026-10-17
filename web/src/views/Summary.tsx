import { Fragment, type ReactNode } from 'react';
import { eventTotals, fmtTime, procRooms, proctorHalves, roomCapacity, summaryTotalValue, type ProcRoom, type Room } from '../lib/model';
import { Swatch, type ViewProps } from './common';

export default function Summary({ state, update, setTime }: Pick<ViewProps, 'state' | 'update' | 'setTime'>) {
  const rows = eventTotals(state);
  type Row = (typeof rows)[number];
  const P = state.config.proctors;
  const minCap = P?.minCap ?? '';
  const big = (r: Room) => r.type === P?.bigType;
  const procInput = (r: Room) => {
    const res = roomCapacity(state, r, minCap);
    const ovr = res.source === 'override';
    return (
      <input type="text" inputMode="numeric" className={`proc-in${ovr ? ' ovr' : ''}`} value={ovr ? res.value! : ''}
        placeholder={res.value != null ? String(res.value) : '—'}
        title={ovr ? 'Proctors (min) override for this room. Clear to use the formula.' : 'Proctors (min) from the formula. Type a number to override it.'}
        onChange={(e) => update((d) => {
          const o = d.rooms.find((x) => x.id === r.id)!.overrides;
          const v = e.target.value.replace(/[^0-9]/g, '');
          if (v === '') delete o[minCap]; else o[minCap] = +v;
        })} />
    );
  };
  type Part = { key: string; node: ReactNode };
  const breakdownParts = (rooms: ProcRoom[]): Part[] => {
    const byType = new Map<string, number>();
    for (const { r } of rooms) if (!big(r)) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    return [
      ...[...byType].map(([t, n]) => ({ key: t, node: `${n} ${t}` })),
      ...rooms.filter(({ r }) => big(r)).sort((x, y) => x.r.name.localeCompare(y.r.name))
        .map(({ r }) => ({ key: r.id, node: <>{r.name} {procInput(r)}</> })),
    ];
  };
  const joinPlus = (parts: Part[], lead = false) =>
    parts.map((p, i) => <Fragment key={p.key}>{i ? ' + ' : lead ? '+ ' : ''}{p.node}</Fragment>);
  const breakdown = (rooms: ProcRoom[]) => {
    const parts = breakdownParts(rooms);
    return parts.length ? joinPlus(parts) : 'No rooms';
  };
  const classroomProctors = (rooms: ProcRoom[]) =>
    rooms.reduce((n, { r, v }) => n + (big(r) ? 0 : v), 0);
  const twoLines = (rooms: ProcRoom[]) => {
    const parts = breakdownParts(rooms);
    if (!parts.length) return ['No rooms'];
    const k = Math.ceil(parts.length / 2);
    return [parts.slice(0, k), parts.slice(k)].filter((l) => l.length).map((l, i) => joinPlus(l, i > 0));
  };
  const roomsOf = (evIds: string[]) => procRooms(state, state.blocks.filter((b) => evIds.includes(b.eventId)).map((b) => b.roomId), minCap);
  const morningRows = P?.rows ?? [];
  const halves = proctorHalves(state);
  const stat = ({ e, total }: Row) => (
    <div key={e.id} className="stat" title={`${fmtTime(e.start)}–${fmtTime(e.end)}`} onClick={() => setTime(e.start)}>
      <span><Swatch color={e.color} />{e.name}</span>
      <b>{total}</b>
    </div>
  );
  const picked = state.config.summaryEventIds.map((id) => rows.find((x) => x.e.id === id)).filter((x) => !!x);
  if (!state.summaryTotals.length && !picked.length && !P) return null;
  const totalStat = (x: (typeof state.summaryTotals)[number]) => {
    const c = state.categories.find((y) => y.id === x.tagId);
    const ct = state.capTypes.find((y) => y.id === x.capType);
    const n = summaryTotalValue(state, x);
    return (
      <div key={x.id} className="stat" title={`${ct?.name ?? x.capType} capacity of all rooms tagged ${c?.name ?? '?'}`}>
        <span>{c && <Swatch color={c.color} />}{x.label}</span><b>{n}</b>
      </div>
    );
  };

  return (
    <div className="summary-block">
      <h2>Summary</h2>
      <div className="summary">
        {state.summaryTotals.map(totalStat)}
        {picked.map(stat)}
      </div>
      {halves.length > 0 && <div className="summary">
        {halves.map((h) => (
          <div key={h.label} className="stat proctors">
            <span>{h.label} proctors</span>
            <b>{h.min.n} <small>min</small> · {h.ideal.n} <small>ideal</small></b>
            {((h.first && morningRows.length > 0) || classroomProctors(h.min.rooms) > 0) && <span className="muted small">{P?.smallLabel}: {h.first && morningRows.length > 0
              ? morningRows.map(({ label, eventIds }) => `${label} ${classroomProctors(roomsOf(eventIds))}`).join(' · ')
              : classroomProctors(h.min.rooms)}</span>}
            {!(h.first && morningRows.length > 0) && <>
              {twoLines(h.min.rooms).map((line, i) => <span key={i} className="muted small">{line}</span>)}
            </>}
            {h.first && morningRows.map(({ label, eventIds }) => (
              <span key={label} className="muted small">{label}: {breakdown(roomsOf(eventIds))}</span>
            ))}
          </div>
        ))}
      </div>}
      {P?.note && <p className="muted small">{P.note}</p>}
    </div>
  );
}
