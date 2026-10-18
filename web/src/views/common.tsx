import { useState } from 'react';
import { DAY_END, DAY_START, SLOT, SLOTS, fmtTime, type State, type TimeRef, type Updater, inSched, alignKey, phaseTimes } from '../lib/model';

export type ViewProps = { state: State; update: Updater; time: number; setTime: (t: number) => void };

export function TimePicker({ time, setTime }: { time: number; setTime: (t: number) => void }) {
  return (
    <span className="timepicker">
      <button onClick={() => setTime(Math.max(SLOTS[0], time - SLOT))}>◀</button>
      <select value={time} onChange={(e) => setTime(+e.target.value)}>
        {SLOTS.map((t) => <option key={t} value={t}>{fmtTime(t)} – {fmtTime(t + SLOT)}</option>)}
      </select>
      <button onClick={() => setTime(Math.min(DAY_END - SLOT, time + SLOT))}>▶</button>
    </span>
  );
}

/** 15-minute choices, plus `value` itself when it is off the grid. */
const timeOpts = (value: number, includeEnd?: boolean) => {
  const opts = includeEnd ? [...SLOTS.slice(1), DAY_END] : [...SLOTS];
  return opts.includes(value) ? opts : [...opts, value].sort((a, b) => a - b);
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Free entry for a time off the 15-minute grid; `onDone(null)` cancels. */
function OtherTime({ value, onDone }: { value: number; onDone: (t: number | null) => void }) {
  const commit = (v: string) => {
    const [h, m] = v.split(':').map(Number);
    onDone(Number.isFinite(h) && Number.isFinite(m) ? Math.min(DAY_END, Math.max(DAY_START, h * 60 + m)) : null);
  };
  return (
    <input type="time" className="time-in" autoFocus defaultValue={hhmm(value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); if (e.key === 'Escape') onDone(null); }} />
  );
}

export function TimeSelect({ value, onChange, includeEnd }: { value: number; onChange: (t: number) => void; includeEnd?: boolean }) {
  const [other, setOther] = useState(false);
  if (other) return <OtherTime value={value} onDone={(t) => { setOther(false); if (t !== null) onChange(t); }} />;
  return (
    <select value={value} onChange={(e) => (e.target.value === 'other' ? setOther(true) : onChange(+e.target.value))}>
      {timeOpts(value, includeEnd).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
      <option value="other">Other time…</option>
    </select>
  );
}

/** Picks either a fixed time or the start/end of a phase (external schedule). */
export function EventTimeSelect({ state, value, timeRef, onChange, includeEnd }: {
  state: State; value: number; timeRef: TimeRef | null; includeEnd?: boolean; onChange: (t: number, ref: TimeRef | null) => void;
}) {
  const [other, setOther] = useState(false);
  const opts = timeRef ? (includeEnd ? [...SLOTS.slice(1), DAY_END] : SLOTS) : timeOpts(value, includeEnd);
  const cur = timeRef ? `p:${timeRef.phaseId}:${timeRef.edge}` : `t:${value}`;
  const pick = (v: string) => {
    if (v === 'other') return setOther(true);
    const [kind, a, b] = v.split(':');
    if (kind === 't') return onChange(+a, null);
    const p = state.phases.find((x) => x.id === a)!;
    const edge = b as TimeRef['edge'];
    onChange(phaseTimes(p, alignKey(state))[edge], { phaseId: a, edge });
  };
  if (other) return <OtherTime value={value} onDone={(t) => { setOther(false); if (t !== null) onChange(t, null); }} />;
  return (
    <select value={cur} onChange={(e) => pick(e.target.value)} className={timeRef ? 'time-sel linked' : 'time-sel'} title={fmtTime(value)}>
      <optgroup label="Phase">
        {state.phases.filter((p) => inSched(p, alignKey(state)) || p.id === timeRef?.phaseId).flatMap((p) => (['start', 'end'] as const).map((edge) => (
          <option key={`${p.id}${edge}`} value={`p:${p.id}:${edge}`} title={fmtTime(phaseTimes(p, alignKey(state))[edge])}>{edge === 'start' ? 'Start' : 'End'} of {p.name}</option>
        )))}
      </optgroup>
      <optgroup label="Time">
        {opts.map((t) => <option key={t} value={`t:${t}`}>{fmtTime(t)}</option>)}
        <option value="other">Other time…</option>
      </optgroup>
    </select>
  );
}

export const Swatch = ({ color }: { color: string }) => <span className="swatch" style={{ background: color }} />;

/** Type-to-confirm (browser confirm() dialogs can be blocked inside embedded previews). */
export function ConfirmButton({ label = 'Delete', word = 'delete', className = 'danger', onConfirm }: {
  label?: string; word?: string; className?: string; onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const close = () => { setOpen(false); setText(''); };
  if (!open) return <button className={className} onClick={() => setOpen(true)}>{label}</button>;
  const ok = text.trim().toLowerCase() === word;
  return (
    <span className="confirm-box">
      <input autoFocus className={ok ? 'confirm-in ok' : 'confirm-in'} value={text} placeholder={`type "${word}"`}
        onChange={(e) => setText(e.target.value)} onBlur={close}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && ok) { close(); onConfirm(); }
        }} />
    </span>
  );
}
