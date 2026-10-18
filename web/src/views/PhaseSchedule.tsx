import { useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import type { PhaseSchedule as Sched } from '../lib/config';
import { DAY_END, DAY_START, applyPhaseRefs, fmtTime, phaseTimes, textColor, uid, type Phase, type State, inSched } from '../lib/model';
import { TimeSelect, type ViewProps } from './common';
import ColorPicker from './ColorPicker';
import { usedColors, defaultColor } from '../lib/colors';

const HOURS: number[] = [];
for (let t = DAY_START; t <= DAY_END; t += 60) HOURS.push(t);
const pct = (t: number) => `${((t - DAY_START) / (DAY_END - DAY_START)) * 100}%`;
type Edge = 'start' | 'end';
type Drag = { id: string; key: string; edge: Edge; t: number };

/** Moving the start shifts the whole phase (same length); moving the end changes its length. */
function withTime(p: Phase, key: string, edge: Edge, t: number): Phase {
  const cur = phaseTimes(p, key);
  const next = edge === 'start'
    ? { start: t, end: Math.min(DAY_END, Math.max(t + 15, t + cur.end - cur.start)) }
    : { end: t, start: Math.min(cur.start, t - 15) };
  return withTimes(p, key, next);
}
function withTimes(p: Phase, key: string, next: { start: number; end: number }): Phase {
  const legacy = key === 'ext' ? { start: next.start, end: next.end } : key === 'int' ? { intStart: next.start, intEnd: next.end } : {};
  return { ...p, ...legacy, times: { ...p.times, [key]: next } };
}

export default function PhaseSchedule({ state, update }: Pick<ViewProps, 'state' | 'update'>) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pop, setPop] = useState<string | null>(null);
  const sched = state.config.phaseSchedules ?? [];
  const align = state.config.alignSchedule ?? sched[0]?.key;

  const edit = (f: (d: State) => void) => update((d) => { f(d); applyPhaseRefs(d); });
  const setPhase = (id: string, f: (p: Phase) => Phase) => edit((d) => { d.phases = d.phases.map((p) => (p.id === id ? f(p) : p)); });
  const setScheds = (scheds: Sched[]) => edit((d) => {
    d.config.phaseSchedules = scheds;
    if (!scheds.some((x) => x.key === d.config.alignSchedule)) d.config.alignSchedule = scheds[0]?.key;
  });
  const shared = (p: Phase) => sched.every((y) => inSched(p, y.key));
  const setShared = (p: Phase, from: string, on: boolean) => setPhase(p.id, (q) => {
    if (!on) return { ...q, scheds: [from] };
    const t = phaseTimes(q, from);
    const r = sched.reduce((x, y) => (x.times?.[y.key] ? x : withTimes(x, y.key, t)), q);
    return { ...r, scheds: undefined };
  });
  const remove = (p: Phase, key: string) => {
    setPop(null);
    const rest = sched.filter((y) => y.key !== key && inSched(p, y.key));
    if (rest.length) setPhase(p.id, (q) => ({ ...q, scheds: rest.map((y) => y.key) }));
    else edit((d) => { d.phases = d.phases.filter((q) => q.id !== p.id); });
  };

  const timeAt = (e: { clientX: number }, track: Element, round = Math.round) => {
    const r = track.getBoundingClientRect();
    const t = DAY_START + ((e.clientX - r.left) / r.width) * (DAY_END - DAY_START);
    return Math.min(DAY_END, Math.max(DAY_START, round(t / 15) * 15));
  };
  const addAt = (key: string, t: number) => {
    const next = Math.min(DAY_END, ...state.phases.filter((p) => inSched(p, key)).map((p) => phaseTimes(p, key).start).filter((s) => s > t));
    const end = Math.min(next, t + 60);
    if (end - t < 15) return;
    const id = uid('p');
    edit((d) => {
      d.phases.push({ id, name: 'New phase', color: defaultColor(state, d.phases.map((p) => p.color)), start: t, end, intStart: t, intEnd: end, times: { [key]: { start: t, end } }, scheds: [key] });
    });
    setPop(id);
  };
  const startDrag = (e: RPointerEvent<HTMLElement>, id: string, key: string, edge: Edge, t: number) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setPop(null);
    setDrag({ id, key, edge, t });
  };
  const moveDrag = (e: RPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const track = e.currentTarget.closest('.ptl-track');
    if (track) setDrag({ ...drag, t: timeAt(e, track) });
  };
  const endDrag = () => {
    if (drag) setPhase(drag.id, (p) => withTime(p, drag.key, drag.edge, drag.t));
    setDrag(null);
  };
  const select = (key: string) => { if (editKey !== key) { setEditKey(key); setPop(null); } };

  return (
    <div className="ptl" style={{ '--ptl-label': `calc(${Math.max(4, ...sched.map((x) => x.name.length))}ch + ${editKey ? 44 : 12}px)` } as CSSProperties}>
      <div className="ptl-head">
        <h3>Tournament schedule</h3>
        {editKey ? <button onClick={() => { setEditKey(null); setPop(null); }}>Done</button>
          : sched.length > 0 && <span className="muted">Click a row to edit its phases.</span>}
      </div>
      {sched.length > 0 && (
        <div className="ptl-axis">
          <div className="ptl-label" />
          <div className="ptl-track">{HOURS.map((t) => <span key={t} style={{ left: pct(t) }}>{fmtTime(t).replace(':00', '')}</span>)}</div>
          <div className="ptl-align" title="Event start/end times linked to a phase follow the selected schedule">Align<br />events</div>
        </div>
      )}
      {sched.map((s) => {
        const on = editKey === s.key;
        return (
          <div key={s.key} className={on ? 'ptl-row sel' : 'ptl-row'} onClick={() => select(s.key)}
            title={on ? undefined : `Click to edit the ${s.name} phases`}>
            <div className="ptl-label">
              <span className="ptl-name">
                {on ? (
                  <>
                    <input value={s.name} aria-label="Schedule name" onChange={(e) => setScheds(sched.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))} />
                    <button className="chip-x" title={`Remove the ${s.name} schedule`} onClick={(e) => { e.stopPropagation(); setEditKey(null); setScheds(sched.filter((x) => x.key !== s.key)); }}>×</button>
                  </>
                ) : s.name}
              </span>
            </div>
            <div className="ptl-track" title={on ? 'Click an empty spot to add a phase' : undefined}
              onClick={(e) => { if (on && e.target === e.currentTarget) { setPop(null); addAt(s.key, timeAt(e, e.currentTarget, Math.floor)); } }}>
              {state.phases.filter((p) => inSched(p, s.key)).map((p) => {
                let { start, end } = phaseTimes(p, s.key);
                if (drag && drag.id === p.id && drag.key === s.key) ({ start, end } = phaseTimes(withTime(p, s.key, drag.edge, drag.t), s.key));
                const open = on && pop === p.id;
                return [
                  <div key={p.id} className="ptl-block" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})`, background: p.color, color: textColor(p.color) }}
                    title={`${p.name}\n${fmtTime(start)}–${fmtTime(end)}${on ? '\nClick to edit; drag the left edge to move, the right edge to resize' : ''}`}
                    onClick={(e) => { if (on) { e.stopPropagation(); setPop(open ? null : p.id); } }}>
                    <b>{p.name}</b><small>{fmtTime(start)}–{fmtTime(end)}</small>
                    {on && (['start', 'end'] as const).map((edge) => (
                      <span key={edge} className={`ptl-h ptl-h-${edge}`} title={edge === 'start' ? 'Drag to move the phase' : 'Drag to change the end time'}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => startDrag(e, p.id, s.key, edge, edge === 'start' ? start : end)}
                        onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)} />
                    ))}
                  </div>,
                  open && (
                    <div key={`${p.id}-pop`} className="ptl-pop" style={start - DAY_START > (DAY_END - DAY_START) / 2 ? { right: `calc(100% - ${pct(end)})` } : { left: pct(start) }} onClick={(e) => e.stopPropagation()}>
                      <ColorPicker value={p.color} existing={usedColors(state)} onChange={(c) => setPhase(p.id, (q) => ({ ...q, color: c }))} />
                      <input value={p.name} aria-label="Phase name" size={Math.max(8, p.name.length)} onChange={(e) => setPhase(p.id, (q) => ({ ...q, name: e.target.value }))} />
                      <label>Start <TimeSelect value={start} onChange={(v) => setPhase(p.id, (q) => withTime(q, s.key, 'start', v))} /></label>
                      <label>End <TimeSelect includeEnd value={end} onChange={(v) => setPhase(p.id, (q) => withTime(q, s.key, 'end', v))} /></label>
                      {sched.length > 1 && (
                        <label title="Show this phase in every schedule, each with its own times">
                          <input type="checkbox" checked={shared(p)} onChange={(e) => setShared(p, s.key, e.target.checked)} /> shared
                        </label>
                      )}
                      <button className="danger" title={sched.some((y) => y.key !== s.key && inSched(p, y.key)) ? `Remove from ${s.name} only` : 'Delete this phase'} onClick={() => remove(p, s.key)}>Delete</button>
                      <button onClick={() => setPop(null)}>Done</button>
                    </div>
                  ),
                ];
              })}
            </div>
            <div className="ptl-align" onClick={(e) => e.stopPropagation()}>
              <input type="radio" name="align-sched" checked={align === s.key}
                aria-label={`Align event blocks to ${s.name}`}
                title={`Event start/end times linked to a phase follow ${s.name}`}
                onChange={() => edit((d) => { d.config.alignSchedule = s.key; })} />
            </div>
          </div>
        );
      })}
      <div className="ptl-add">
        <button onClick={() => {
          const key = uid('s');
          setScheds([...sched, { key, name: `Schedule ${sched.length + 1}` }]);
          setEditKey(key);
        }}>+ Add schedule</button>
        {!sched.length && <span className="muted">No schedules yet. Each one adds a phase column to the Schedule page.</span>}
      </div>
    </div>
  );
}
