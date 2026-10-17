import type { PhaseSchedule } from '../lib/config';
import { useMemo, useState } from 'react';
import { phaseTimes, DAY_START, SLOT, SLOTS, clashMessage, clashWith, fmtTime, groupedEvents, roomActive, roomCapacity, textColor, uid } from '../lib/model';
import { Swatch, type ViewProps } from './common';
import Summary from './Summary';

const ROW = 18;

const phaseCols = (sched: PhaseSchedule[] = []) => sched.map((p) => [p.name, p.key] as const);

export default function Schedule({ state, update, time, setTime }: ViewProps) {
  const [edit, setEdit] = useState<{ blockId: string; text: string; room: boolean } | null>(null);
  const [paint, setPaint] = useState(state.events[0]?.id ?? '');
  const [building, setBuilding] = useState('All');
  const active = state.rooms.filter(roomActive);
  const buildings = useMemo(() => ['All', ...new Set(state.rooms.filter(roomActive).map((r) => r.building))], [state.rooms]);
  const rooms = active.filter((r) => building === 'All' || r.building === building);
  const paintEv = state.events.find((e) => e.id === paint);

  const [clashMsg, setClashMsg] = useState('');
  const addBlock = (roomId: string) => {
    if (!paintEv) return;
    const clash = state.blocks
      .filter((b) => b.roomId === roomId)
      .map((b) => state.events.find((e) => e.id === b.eventId)!)
      .filter((e) => e && clashWith(state, paintEv, e));
    if (clash.some((e) => e.id === paintEv.id)) return;
    if (clash.length) {
      const room = state.rooms.find((r) => r.id === roomId);
      setClashMsg(clashMessage(state, 'add', paintEv, room?.name ?? roomId, clash[0]));
      return;
    }
    setClashMsg('');
    update((d) => { d.blocks.push({ id: uid('b'), roomId, eventId: paintEv.id }); });
  };

  return (
    <div className="schedule-view">
      <Summary state={state} update={update} setTime={setTime} />
      <div className="toolbar">
        <label>Place event:&nbsp;
          <select value={paint} onChange={(e) => setPaint(e.target.value)}>
            {groupedEvents(state).map(({ group, events }) => (
              <optgroup key={group} label={group}>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name} ({fmtTime(e.start)}–{fmtTime(e.end)})</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {paintEv && <Swatch color={paintEv.color} />}
        {clashMsg ? <span className="hint warn">{clashMsg}</span> : <span className="hint">Click a room column to add the selected event; hover a block and click × to delete it. Click a time to select it.</span>}
        <label>Building:&nbsp;
          <select value={building} onChange={(e) => setBuilding(e.target.value)}>
            {buildings.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
      </div>
      <div className="grid-wrap">
        <div className="grid" style={{ gridTemplateColumns: `70px ${'78px '.repeat((state.config.phaseSchedules ?? []).length)}repeat(${rooms.length}, 78px)` }}>
          <div className="corner">Time</div>
          {phaseCols(state.config.phaseSchedules).map(([label, key], i) => (
            <div key={key} className="room-head phase-head" style={{ left: 70 + i * 78 }} title="Edit phases on Events">
              <b>{label}</b><small>schedule</small><small>phases</small>
            </div>
          ))}
          {rooms.map((r) => (
            <div key={r.id} className="room-head" title={`${r.name} · ${r.type} · [Raw] ${r.base ?? '—'}`}>
              <b>{r.name}</b><small>{r.type}</small><small>[Raw] {r.base ?? '—'}</small>
            </div>
          ))}
          <div className="times">
            {SLOTS.map((t) => (
              <div key={t} className={t === time ? 'time sel' : 'time'} style={{ height: ROW }} onClick={() => setTime(t)}>
                {t % 60 === 0 ? fmtTime(t) : `:${t % 60}`}
              </div>
            ))}
          </div>
          {phaseCols(state.config.phaseSchedules).map(([label, key], i) => (
            <div key={key} className="col phase-col" style={{ height: SLOTS.length * ROW, left: 70 + i * 78 }}>
              <div className="now" style={{ top: ((time - DAY_START) / SLOT) * ROW, height: ROW }} />
              {state.phases.map((p) => {
                const { start: s0, end: e0 } = phaseTimes(p, key);
                return (
                  <div key={p.id} className="block"
                    style={{ top: ((s0 - DAY_START) / SLOT) * ROW, height: ((e0 - s0) / SLOT) * ROW - 1, background: p.color, color: textColor(p.color) }}
                    title={`${p.name} (${label})\n${fmtTime(s0)}–${fmtTime(e0)}`}>
                    <span className="bname">{p.name}</span>
                    <span className="bcap">{fmtTime(s0)}–{fmtTime(e0)}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {rooms.map((r) => {
            const evs = state.blocks.filter((b) => b.roomId === r.id)
              .map((b) => ({ b, e: state.events.find((e) => e.id === b.eventId)! })).filter((x) => x.e);
            return (
              <div key={r.id} className="col" style={{ height: SLOTS.length * ROW }} onClick={() => addBlock(r.id)}>
                <div className="now" style={{ top: ((time - DAY_START) / SLOT) * ROW, height: ROW }} />
                {evs.map(({ b, e }) => {
                  const clash = evs.some((o) => o.b.id !== b.id && !!clashWith(state, o.e, e));
                  const cap = roomCapacity(state, r, e.capacityType).value;
                  return (
                    <div key={b.id} className={clash ? 'block clash' : 'block'}
                      style={{ top: ((e.start - DAY_START) / SLOT) * ROW, height: ((e.end - e.start) / SLOT) * ROW - 1, background: e.color, color: textColor(e.color) }}
                      title={`${e.name}\n${fmtTime(e.start)}–${fmtTime(e.end)}\n${r.name}: ${cap ?? '—'} (${e.capacityType})`}
                      onClick={(ev) => { ev.stopPropagation(); if (!edit) setEdit({ blockId: b.id, text: b.signName ?? e.signName ?? e.name, room: !!b.signName }); }}>
                      <span className="bname">{(!e.signHide && (b.signName?.trim() || e.signName?.trim())) || e.name}</span>
                      {cap != null && <span className="bcap">Capacity {cap}</span>}
                      <button className="del" title="Remove from this room" onClick={(ev) => { ev.stopPropagation(); update((d) => { d.blocks = d.blocks.filter((x) => x.id !== b.id); }); }}>×</button>
                      {edit?.blockId === b.id && (
                        <div className="sign-editor" onClick={(ev) => ev.stopPropagation()}>
                          <b>Room sign label: {e.name}</b>
                          <span className="muted">Each line prints as its own line on the sign.</span>
                          <textarea rows={4} autoFocus value={edit.text} onChange={(x) => setEdit({ ...edit, text: x.target.value })} />
                          <label title="Use this label on this room's sign only; other rooms keep the event's label"><input type="checkbox" checked={edit.room} onChange={(x) => setEdit({ ...edit, room: x.target.checked })} /> Only in {r.name}</label>
                          <label><input type="checkbox" checked={!!e.signFirst} onChange={(x) => update((d) => { const t = d.events.find((y) => y.id === e.id); if (t) t.signFirst = x.target.checked || undefined; })} /> List first on room signs</label>
                          <div className="toolbar">
                            <button className="primary" onClick={() => {
                              const v = edit.text.replace(/\s+$/, '');
                              update((d) => {
                                const blk = d.blocks.find((y) => y.id === b.id), t = d.events.find((y) => y.id === e.id);
                                if (edit.room) { if (blk) blk.signName = v.trim() && v.trim() !== (t?.signName?.trim() || e.name) ? v : undefined; }
                                else { if (blk) blk.signName = undefined; if (t) t.signName = v.trim() && v.trim() !== e.name ? v : undefined; }
                              });
                              setEdit(null);
                            }}>Save</button>
                            <button onClick={() => setEdit(null)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
