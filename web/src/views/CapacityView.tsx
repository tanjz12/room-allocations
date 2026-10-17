import { useState } from 'react';
import { isSub, eventAt, fmtTime, groupedEvents, roomActive, roomCapacity, roomTags } from '../lib/model';
import { Swatch, TimePicker, type ViewProps } from './common';

export default function CapacityView({ state, time, setTime }: ViewProps) {
  const [showAll, setShowAll] = useState(false);
  const rows = state.events.map((e) => {
    const rooms = state.blocks.filter((b) => b.eventId === e.id).map((b) => {
      const r = state.rooms.find((x) => x.id === b.roomId && roomActive(x))!;
      return { r, cap: r ? roomCapacity(state, r, e.capacityType).value : null };
    }).filter((x) => x.r);
    return { e, rooms, total: rooms.reduce((s, x) => s + (x.cap ?? 0), 0), active: eventAt(e, time) };
  });
  const active = rows.filter((x) => x.active);
  const capName = (id: string) => state.capTypes.find((c) => c.id === id)?.name ?? id;
  type Row = (typeof rows)[number];
  const rowOf = new Map(rows.map((x) => [x.e.id, x]));
  const isFocus = (x: Row) => isSub(state, x.e);
  const sum = (xs: Row[], f: (x: Row) => number) => xs.reduce((s, x) => s + f(x), 0);
  const sections = (keep: (x: Row) => boolean, cols: number, row: (x: Row, sub: boolean) => React.ReactNode, focusRow: (f: Row[]) => React.ReactNode) =>
    groupedEvents(state).map(({ group, events }) => {
      const items = events.map((e) => rowOf.get(e.id)!).filter(keep);
      if (!items.length) return null;
      const focus = items.filter(isFocus);
      return (
        <tbody key={group}>
          <tr className="group-row"><th colSpan={cols}>{group}</th></tr>
          {items.flatMap((x, i) => [
            ...(isFocus(x) && !(i > 0 && isFocus(items[i - 1])) ? [focusRow(focus)] : []),
            row(x, isFocus(x)),
          ])}
        </tbody>
      );
    });
  const byCat = new Map<string, number>();
  for (const x of active) for (const { r, cap } of x.rooms) {
    const tags = roomTags(state, r).map((c) => c.name);
    for (const k of tags.length ? tags : ['Untagged']) byCat.set(k, (byCat.get(k) ?? 0) + (cap ?? 0));
  }

  return (
    <div className="page">
      <div className="toolbar"><b>Time:</b> <TimePicker time={time} setTime={setTime} /></div>
      <h2>Capacity assigned at {fmtTime(time)}</h2>
      {active.length === 0 ? <p>No events at this time.</p> : (
        <table className="table">
          <thead><tr><th>Event</th><th>Total capacity</th><th>Room breakdown</th></tr></thead>
          {sections((x) => x.active, 3, ({ e, rooms, total }, sub) => (
            <tr key={e.id} className={sub ? 'sub-row' : undefined}>
              <td><Swatch color={e.color} /> <b>{e.name}</b></td>
              <td className="num"><b>{total}</b></td>
              <td className="chips">{rooms.map(({ r, cap }) => <span key={r.id} className="chip">{r.name} <b>{cap ?? '—'}</b></span>)}</td>
            </tr>
          ), (f) => (
            <tr key="focus" className="focus-row">
              <td><b>{state.config.subgroup?.name}</b> <span className="muted">({f.length})</span></td>
              <td className="num"><b>{sum(f, (x) => x.total)}</b></td><td></td>
            </tr>
          ))}
        </table>
      )}
      {byCat.size > 0 && <p className="muted">By tag: {[...byCat].map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
      <h2>All events <button onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide' : 'Show'}</button></h2>
      {showAll && <table className="table">
        <thead><tr><th></th><th>Event</th><th>Schedule</th><th>Capacity type</th><th>Total capacity</th><th>Room breakdown</th></tr></thead>
        {sections(() => true, 6, ({ e, rooms, total, active }, sub) => (
          <tr key={e.id} className={[active ? 'hl' : '', sub ? 'sub-row' : ''].join(' ')} onClick={() => setTime(e.start)} style={{ cursor: 'pointer' }}>
            <td><Swatch color={e.color} /></td><td>{e.name}</td>
            <td className={sub ? 'muted' : undefined}>{fmtTime(e.start)}–{fmtTime(e.end)}</td>
            <td>{capName(e.capacityType)}</td><td className="num">{total}</td>
            <td className="chips">{rooms.map(({ r, cap }) => <span key={r.id} className="chip">{r.name} <b>{cap ?? '—'}</b></span>)}</td>
          </tr>
        ), (f) => (
          <tr key="focus" className="focus-row" onClick={() => setTime(f[0].e.start)} style={{ cursor: 'pointer' }}>
            <td></td><td><b>{state.config.subgroup?.name}</b> <span className="muted">({f.length})</span></td>
            <td>{fmtTime(f[0].e.start)}–{fmtTime(f[0].e.end)}</td><td></td>
            <td className="num">{sum(f, (x) => x.total)}</td><td></td>
          </tr>
        ))}
      </table>}
    </div>
  );
}
