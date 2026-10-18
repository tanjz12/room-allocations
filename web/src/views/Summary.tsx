import { Fragment, type ReactNode } from 'react';
import { baseType, fmtTime, phaseEvents, roomCapacity, summaryValue, typeMatches, type Room, phaseTimes, alignKey } from '../lib/model';
import type { SummaryRow } from '../lib/config';
import { Swatch, type ViewProps } from './common';
import SummarySettings from './SummarySettings';

export default function Summary({ state, update, setTime }: Pick<ViewProps, 'state' | 'update' | 'setTime'>) {
  const rows = state.config.summary ?? [];
  const pills = state.config.proctorCaps?.pills ?? [];
  const minCap = pills[0]?.capType ?? '';
  const minName = state.capTypes.find((c) => c.id === minCap)?.name ?? '';
  const listed = (r: Room) => (state.config.proctorCaps?.listed ?? []).some((t) => typeMatches(r, t));
  const procInput = (r: Room) => {
    const res = roomCapacity(state, r, minCap);
    const ovr = res.source === 'override';
    return (
      <input type="text" inputMode="numeric" className={`proc-in${ovr ? ' ovr' : ''}`} value={ovr ? res.value! : ''}
        placeholder={res.value != null ? String(res.value) : '—'} onClick={(e) => e.stopPropagation()}
        title={ovr ? `${minName} override for this room. Clear to use the formula.` : `${minName} from the formula. Type a number to override it.`}
        onChange={(e) => update((d) => {
          const o = d.rooms.find((x) => x.id === r.id)!.overrides;
          const v = e.target.value.replace(/[^0-9]/g, '');
          if (v === '') delete o[minCap]; else o[minCap] = +v;
        })} />
    );
  };
  /** "30 Small + 20 Large + Pauley [20]": other rooms counted by type, listed-type rooms one by one with an editable count. */
  const breakdown = (rooms: Room[]) => {
    const byType = new Map<string, number>();
    for (const r of rooms) if (!listed(r)) { const t = baseType(r.type); byType.set(t, (byType.get(t) ?? 0) + 1); }
    const parts: { key: string; node: ReactNode }[] = [
      ...[...byType].map(([t, n]) => ({ key: t, node: `${n} ${t}` })),
      ...rooms.filter(listed).sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => ({ key: r.id, node: <span className="nowrap">{r.name} {procInput(r)}</span> })),
    ];
    return parts.map((p, i) => <Fragment key={p.key}>{i ? ' + ' : ''}{p.node}</Fragment>);
  };
  const stat = (x: SummaryRow) => {
    const v = summaryValue(state, x);
    const rooms = `${v.rooms.length} room${v.rooms.length === 1 ? '' : 's'}`;
    if (x.kind === 'event') {
      const e = state.events.find((y) => y.id === x.eventId);
      return (
        <div key={x.id} className="stat" title={e ? `${fmtTime(e.start)}–${fmtTime(e.end)}, ${rooms}` : rooms} onClick={() => e && setTime(e.start)}>
          <span>{e && <Swatch color={e.color} />}{x.label}</span><b>{v.n}</b>
        </div>
      );
    }
    if (x.kind === 'cap') {
      const ct = state.capTypes.find((y) => y.id === x.capType);
      return (
        <div key={x.id} className="stat" title={`${ct?.name ?? x.capType} of every ${[...(x.tags ?? []).map((id) => state.categories.find((c) => c.id === id)?.name ?? id), ...x.types].join(' / ') || '—'} room${x.group ? ` used for ${x.group}` : ''}: ${rooms}`}>
          <span>{(() => { const c = (x.tags ?? []).map((id) => state.categories.find((z) => z.id === id)).find((z) => z); return c && <Swatch color={c.color} />; })()}{x.label.replace(/\s*\bcapacity\b/i, '')}</span><b>{v.n}</b>
        </div>
      );
    }
    const phs = v.phases ?? [];
    const evs = (ph: (typeof phs)[number]['ph']) => [...new Set(phaseEvents(state, ph, x.group).map((e) => e.name))].join(', ') || 'none';
    return (
      <div key={x.id} className="stat proctors" onClick={() => phs[0] && setTime(phaseTimes(phs[0].ph, alignKey(state)).start)}
        title={`Rooms with a ${x.group || '—'} event starting in ${phs.map((q) => `${q.ph.name} (${fmtTime(phaseTimes(q.ph, alignKey(state)).start)}–${fmtTime(phaseTimes(q.ph, alignKey(state)).end)}: ${evs(q.ph)})`).join(', ') || '?'}${phs.length > 1 ? '; each number is the largest phase' : ''}`}>
        <span>{x.label}</span>
        <b>{pills.map((p, i) => <Fragment key={i}>{i ? ' · ' : ''}{v.pills?.[i] ?? 0} <small>{p.name}</small></Fragment>)}</b>
        {phs.map((q) => q.rooms.length > 0 && <span key={q.ph.id} className="muted small">{phs.length > 1 && <>{q.ph.name}: </>}{breakdown(q.rooms)}</span>)}
      </div>
    );
  };

  return (
    <div className="summary-block">
      {rows.length > 0 && <><h2>Summary</h2><div className="summary">{[rows.filter((x) => x.kind !== 'proctors'), rows.filter((x) => x.kind === 'proctors')].filter((g) => g.length).map((g, i) => <div key={i} className="summary-group">{g.map(stat)}</div>)}</div></>}
      <details className="summary-edit">
        <summary>Edit summary</summary>
        <SummarySettings state={state} update={update} />
      </details>
    </div>
  );
}
