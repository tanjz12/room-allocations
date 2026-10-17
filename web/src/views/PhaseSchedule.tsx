import { useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import type { PhaseSchedule as Sched } from '../lib/config';
import { DAY_END, DAY_START, applyPhaseRefs, fmtTime, phaseTimes, textColor, uid, type Phase } from '../lib/model';
import { TimeSelect, type ViewProps } from './common';
import ColorPicker from './ColorPicker';
import { usedColors, defaultColor } from '../lib/colors';

const HOURS: number[] = [];
for (let t = DAY_START; t <= DAY_END; t += 60) HOURS.push(t);
const pct = (t: number) => `${((t - DAY_START) / (DAY_END - DAY_START)) * 100}%`;
type Edge = 'start' | 'end';
type Drag = { id: string; key: string; edge: Edge; t: number };

/** `keepLength`: moving the start shifts the end too, so the phase keeps its length. */
function withTime(p: Phase, key: string, edge: Edge, t: number, keepLength = false): Phase {
  const cur = phaseTimes(p, key);
  const next = edge === 'start'
    ? { start: t, end: keepLength ? Math.min(DAY_END, Math.max(t + 15, t + cur.end - cur.start)) : Math.max(cur.end, t + 15) }
    : { end: t, start: Math.min(cur.start, t - 15) };
  const legacy = key === 'ext' ? { start: next.start, end: next.end } : key === 'int' ? { intStart: next.start, intEnd: next.end } : {};
  return { ...p, ...legacy, times: { ...p.times, [key]: next } };
}

export default function PhaseSchedule({ state, update }: Pick<ViewProps, 'state' | 'update'>) {
  const [draft, setDraft] = useState<{ phases: Phase[]; scheds: Sched[]; align?: string } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pop, setPop] = useState<{ id: string; key: string } | null>(null);
  const phases = draft?.phases ?? state.phases;
  const sched = draft?.scheds ?? state.config.phaseSchedules ?? [];
  const align = (draft ? draft.align : state.config.alignSchedule) ?? sched[0]?.key;

  const setTime = (id: string, key: string, edge: Edge, t: number, keepLength = false) => {
    if (draft) setDraft({ ...draft, phases: draft.phases.map((p) => (p.id === id ? withTime(p, key, edge, t, keepLength) : p)) });
    else update((d) => { d.phases = d.phases.map((p) => (p.id === id ? withTime(p, key, edge, t, keepLength) : p)); applyPhaseRefs(d); });
  };
  const setPhase = (id: string, patch: Partial<Phase>) => setDraft((d) => d && { ...d, phases: d.phases.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const setScheds = (scheds: Sched[]) => {
    if (draft) return setDraft({ ...draft, scheds });
    update((d) => {
      d.config.phaseSchedules = scheds;
      if (!scheds.some((x) => x.key === d.config.alignSchedule)) d.config.alignSchedule = scheds[0]?.key;
      applyPhaseRefs(d);
    });
  };
  const save = () => {
    update((d) => {
      d.phases = draft!.phases;
      d.config.phaseSchedules = draft!.scheds;
      d.config.alignSchedule = draft!.scheds.some((x) => x.key === draft!.align) ? draft!.align : draft!.scheds[0]?.key;
      applyPhaseRefs(d);
    });
    setDraft(null);
  };

  const timeAt = (e: RPointerEvent, track: Element) => {
    const r = track.getBoundingClientRect();
    const t = DAY_START + ((e.clientX - r.left) / r.width) * (DAY_END - DAY_START);
    return Math.min(DAY_END, Math.max(DAY_START, Math.round(t / 15) * 15));
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
    if (drag) setTime(drag.id, drag.key, drag.edge, drag.t);
    setDrag(null);
  };

  return (
    <div className="ptl" style={{ '--ptl-label': draft ? '190px' : `calc(${Math.max(4, ...sched.map((x) => x.name.length))}ch + 12px)` } as CSSProperties}>
      <div className="ptl-head">
        <h3>Tournament schedule</h3>
        {draft ? (
          <>
            <button className="primary" onClick={save}>Save</button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </>
        ) : <button onClick={() => { setPop(null); setDraft({ phases: structuredClone(state.phases), scheds: structuredClone(sched), align }); }}>Edit</button>}
      </div>
      {sched.length > 0 && (
        <div className="ptl-axis">
          <div className="ptl-label" />
          <div className="ptl-track">{HOURS.map((t) => <span key={t} style={{ left: pct(t) }}>{fmtTime(t).replace(':00', '')}</span>)}</div>
          <div className="ptl-align" title="Event start/end times linked to a phase follow the selected schedule">Align event blocks to</div>
        </div>
      )}
      {sched.map((s) => (
        <div key={s.key} className="ptl-row">
          <div className="ptl-label">
            <span className="ptl-name">
              {draft ? (
                <>
                  <input value={s.name} aria-label="Schedule name" onChange={(e) => setScheds(sched.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))} />
                  <button className="chip-x" title={`Remove the ${s.name} schedule`} onClick={() => setScheds(sched.filter((x) => x.key !== s.key))}>×</button>
                </>
              ) : s.name}
            </span>
          </div>
          <div className="ptl-track">
            {phases.map((p) => {
              let { start, end } = phaseTimes(p, s.key);
              if (drag && drag.id === p.id && drag.key === s.key) ({ start, end } = phaseTimes(withTime(p, s.key, drag.edge, drag.t), s.key));
              const open = pop?.id === p.id && pop.key === s.key;
              return [
                <div key={p.id} className="ptl-block" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})`, background: p.color, color: textColor(p.color) }}
                  title={`${p.name}\n${fmtTime(start)}–${fmtTime(end)}\nClick to edit times, or drag either end`}
                  onClick={() => setPop(open ? null : { id: p.id, key: s.key })}>
                  <b>{p.name}</b><small>{fmtTime(start)}–{fmtTime(end)}</small>
                  {(['start', 'end'] as const).map((edge) => (
                    <span key={edge} className={`ptl-h ptl-h-${edge}`} title={`Drag to change the ${edge} time`}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => startDrag(e, p.id, s.key, edge, edge === 'start' ? start : end)}
                      onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)} />
                  ))}
                </div>,
                open && (
                  <div key={`${p.id}-pop`} className="ptl-pop" style={{ left: pct(start) }}>
                    <b>{p.name}</b> ({s.name})
                    <label>Start <TimeSelect value={start} onChange={(v) => setTime(p.id, s.key, 'start', v, true)} /></label>
                    <label>End <TimeSelect includeEnd value={end} onChange={(v) => setTime(p.id, s.key, 'end', v)} /></label>
                    <button onClick={() => setPop(null)}>Done</button>
                  </div>
                ),
              ];
            })}
          </div>
          <div className="ptl-align">
            <input type="radio" name="align-sched" checked={align === s.key} disabled={!draft}
              aria-label={`Align event blocks to ${s.name}`}
              title={draft ? `Event start/end times linked to a phase follow ${s.name}` : 'Click Edit to change which schedule event blocks align to'}
              onChange={() => setDraft((d) => d && { ...d, align: s.key })} />
          </div>
        </div>
      ))}
      <div className="ptl-add">
        <button onClick={() => {
          const key = uid('s');
          const scheds = [...sched, { key, name: `Schedule ${sched.length + 1}` }];
          if (draft) setDraft({ ...draft, scheds, align: draft.scheds.some((x) => x.key === draft.align) ? draft.align : key });
          else setScheds(scheds);
        }}>+ Add schedule</button>
        {!sched.length && <span className="muted">No schedules yet. Each one adds a phase column to the Schedule page.</span>}
      </div>
      {draft && (
        <>
          <table className="table">
            <thead><tr><th>Color</th><th>Phase</th><th>Linked events</th><th></th></tr></thead>
            <tbody>
              {draft.phases.map((p) => (
                <tr key={p.id}>
                  <td><ColorPicker value={p.color} existing={usedColors(state)} onChange={(x) => setPhase(p.id, { color: x })} /></td>
                  <td><input value={p.name} onChange={(x) => setPhase(p.id, { name: x.target.value })} /></td>
                  <td className="muted">{state.events.filter((e) => e.startRef?.phaseId === p.id || e.endRef?.phaseId === p.id).map((e) => e.name).join(', ')}</td>
                  <td><button className="danger" onClick={() => setDraft({ ...draft, phases: draft.phases.filter((x) => x.id !== p.id) })}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => {
            const start = Math.min(DAY_END - 15, Math.max(DAY_START + 60, ...draft.phases.map((p) => phaseTimes(p, align ?? 'ext').end)));
            const end = Math.min(DAY_END, start + 60);
            const times = Object.fromEntries(sched.map((x) => [x.key, { start, end }]));
            setDraft({ ...draft, phases: [...draft.phases, { id: uid('p'), name: 'New phase', color: defaultColor(state, draft.phases.map((p) => p.color)), start, end, intStart: start, intEnd: end, times }] });
          }}>+ Add phase</button>
        </>
      )}
    </div>
  );
}
