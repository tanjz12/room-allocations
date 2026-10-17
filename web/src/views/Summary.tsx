import { Fragment, type ReactNode } from 'react';
import { baseType, eventAt, eventTotals, roomListed, fmtTime, procRooms, proctorPills, roomCapacity, summaryTotalValue, type ProcRoom, type Room } from '../lib/model';
import type { ProctorLine } from '../lib/config';
import { Swatch, type ViewProps } from './common';
import SummarySettings from './SummarySettings';

export default function Summary({ state, update, setTime }: Pick<ViewProps, 'state' | 'update' | 'setTime'>) {
  const rows = eventTotals(state);
  type Row = (typeof rows)[number];
  const P = state.config.proctors;
  const minCap = P?.minCap ?? '';
  const big = (r: Room) => roomListed(P, r);
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
    for (const { r } of rooms) if (!big(r)) { const t = baseType(r.type); byType.set(t, (byType.get(t) ?? 0) + 1); }
    return [
      ...[...byType].map(([t, n]) => ({ key: t, node: `${n} ${t}` })),
      ...rooms.filter(({ r }) => big(r)).sort((x, y) => x.r.name.localeCompare(y.r.name))
        .map(({ r }) => ({ key: r.id, node: <span className="nowrap">{r.name} {procInput(r)}</span> })),
    ];
  };
  const joinPlus = (parts: Part[]) =>
    parts.map((p, i) => <Fragment key={p.key}>{i ? ' + ' : ''}{p.node}</Fragment>);
  const pills = proctorPills(state);
  type PillRes = (typeof pills)[number];
  const lineRooms = (h: PillRes, l: ProctorLine) => {
    const rooms = l.eventIds.length
      ? procRooms(state, state.blocks.filter((b) => {
        const e = l.eventIds.includes(b.eventId) && state.events.find((x) => x.id === b.eventId);
        return e && h.slots.some((t) => eventAt(e, t));
      }).map((b) => b.roomId), minCap)
      : h.min.rooms;
    return rooms.filter(({ r }) => (l.rooms === 'listed' ? big(r) : l.rooms === 'others' ? !big(r) : true));
  };
  const line = (h: PillRes, l: ProctorLine, i: number) => {
    const rooms = lineRooms(h, l);
    if (!rooms.length) return null;
    return <span key={i} className="muted small">{l.label && <>{l.label}: </>}{joinPlus(breakdownParts(rooms))}, {rooms.reduce((n, x) => n + x.v, 0)} proctors</span>;
  };
  const stat = ({ e, total }: Row) => (
    <div key={e.id} className="stat" title={`${fmtTime(e.start)}–${fmtTime(e.end)}`} onClick={() => setTime(e.start)}>
      <span><Swatch color={e.color} />{e.name}</span>
      <b>{total}</b>
    </div>
  );
  const picked = state.config.summaryEventIds.map((id) => rows.find((x) => x.e.id === id)).filter((x) => !!x);
  const only = (x: (typeof state.summaryTotals)[number]) => {
    const names = [...(x.eventGroups ?? []), ...(x.eventIds ?? []).map((id) => state.events.find((e) => e.id === id)?.name ?? id)];
    return names.length ? ` with ${names.join(' / ')} scheduled` : '';
  };
  const totalStat = (x: (typeof state.summaryTotals)[number]) => {
    const c = state.categories.find((y) => y.id === x.tagId);
    const ct = state.capTypes.find((y) => y.id === x.capType);
    const n = summaryTotalValue(state, x);
    return (
      <div key={x.id} className="stat" title={`${ct?.name ?? x.capType} capacity of all rooms tagged ${c?.name ?? '?'}${only(x)}`}>
        <span>{c && <Swatch color={c.color} />}{x.label}</span><b>{n}</b>
      </div>
    );
  };

  return (
    <div className="summary-block">
      {(state.summaryTotals.length > 0 || picked.length > 0 || !!P) && <><h2>Summary</h2>
      <div className="summary">
        {state.summaryTotals.map(totalStat)}
        {picked.map(stat)}
      </div>
      {pills.length > 0 && <div className="summary">
        {pills.map((h) => (
          <div key={h.pill.id} className="stat proctors">
            <span>{h.pill.name}</span>
            <b>{h.min.n} <small>min</small> · {h.ideal.n} <small>ideal</small></b>
            {h.pill.lines.map((l, i) => line(h, l, i))}
          </div>
        ))}
      </div>}
      {P?.note && <p className="muted small">{P.note}</p>}</>}
      <details className="summary-edit">
        <summary>Edit summary</summary>
        <SummarySettings state={state} update={update} />
      </details>
    </div>
  );
}
