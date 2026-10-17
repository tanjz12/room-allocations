import { useState } from 'react';
import { DAY_END, SLOT, SLOTS, fmtTime, type State, type TimeRef, type Updater } from '../lib/model';

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

export function TimeSelect({ value, onChange, includeEnd }: { value: number; onChange: (t: number) => void; includeEnd?: boolean }) {
  const opts = includeEnd ? [...SLOTS.slice(1), DAY_END] : SLOTS;
  return (
    <select value={value} onChange={(e) => onChange(+e.target.value)}>
      {opts.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
    </select>
  );
}

/** Picks either a fixed time or the start/end of a phase (external schedule). */
export function EventTimeSelect({ state, value, timeRef, onChange, includeEnd }: {
  state: State; value: number; timeRef: TimeRef | null; includeEnd?: boolean; onChange: (t: number, ref: TimeRef | null) => void;
}) {
  const opts = includeEnd ? [...SLOTS.slice(1), DAY_END] : SLOTS;
  const cur = timeRef ? `p:${timeRef.phaseId}:${timeRef.edge}` : `t:${value}`;
  const pick = (v: string) => {
    const [kind, a, b] = v.split(':');
    if (kind === 't') return onChange(+a, null);
    const p = state.phases.find((x) => x.id === a)!;
    const edge = b as TimeRef['edge'];
    onChange(p[edge], { phaseId: a, edge });
  };
  return (
    <select value={cur} onChange={(e) => pick(e.target.value)} className={timeRef ? 'time-sel linked' : 'time-sel'} title={fmtTime(value)}>
      <optgroup label="Phase">
        {state.phases.flatMap((p) => (['start', 'end'] as const).map((edge) => (
          <option key={`${p.id}${edge}`} value={`p:${p.id}:${edge}`} title={fmtTime(p[edge])}>{edge === 'start' ? 'Start' : 'End'} of {p.name}</option>
        )))}
      </optgroup>
      <optgroup label="Time">
        {opts.map((t) => <option key={t} value={`t:${t}`}>{fmtTime(t)}</option>)}
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
