import { roomTypes, uid, type State } from '../lib/model';
import { Fragment } from 'react';
import type { PillBound, ProctorPill, Proctors } from '../lib/config';
import { ConfirmButton, type ViewProps } from './common';

const newPill = (name: string, group: string): ProctorPill => ({ id: uid('pill'), name, group, excludeIds: [], lines: [{ label: '', eventIds: [] }] });

/** Chips for a list of event ids, with × to remove and a + select to add. */
function EventChips({ state, ids, onChange, pool }: { state: State; ids: string[]; onChange: (ids: string[]) => void; pool?: string[] }) {
  const name = (id: string) => state.events.find((e) => e.id === id)?.name ?? id;
  const free = state.events.filter((e) => !ids.includes(e.id) && (!pool || pool.includes(e.id)));
  return (
    <span className="tags-cell">
      {ids.map((id) => (
        <span key={id} className="chip tag-chip">{name(id)}
          <button className="chip-x" title={`Remove ${name(id)}`} onClick={() => onChange(ids.filter((x) => x !== id))}>×</button></span>
      ))}
      {free.length > 0 && <select className="tag-add" title="Add event" value="" onChange={(e) => e.target.value && onChange([...ids, e.target.value])}>
        <option value="" hidden>+</option>
        {free.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>}
    </span>
  );
}

export default function SummarySettings({ state, update }: Pick<ViewProps, 'state' | 'update'>) {
  const groups = [...new Set([...(state.config.eventGroups ?? []), ...state.events.map((e) => e.group).filter(Boolean)])];
  const capTypes = state.capTypes;
  const types = roomTypes(state);
  const P = state.config.proctors;
  const setP = (f: (p: Proctors) => void) => update((d) => { if (d.config.proctors) f(d.config.proctors); });
  const boundSelect = (b: PillBound | undefined, side: 'from' | 'to', set: (b?: PillBound) => void) => {
    const v = !b ? '' : 'time' in b ? 't' : `${b.edge}:${b.phaseId}`;
    return <>
      <select value={v} onChange={(e) => {
        const x = e.target.value;
        if (!x) set(); else if (x === 't') set({ time: 720 });
        else { const [edge, phaseId] = x.split(/:(.*)/s); set({ phaseId, edge: edge as 'start' | 'end' }); }
      }}>
        <option value="">{side === 'from' ? 'start of day' : 'end of day'}</option>
        <option value="t">a time…</option>
        {state.phases.map((ph) => <Fragment key={ph.id}>
          <option value={`start:${ph.id}`}>{ph.name} starts</option>
          <option value={`end:${ph.id}`}>{ph.name} ends</option>
        </Fragment>)}
      </select>
      {b && 'time' in b && <> <input type="time" step={900} value={`${String(Math.floor(b.time / 60)).padStart(2, '0')}:${String(b.time % 60).padStart(2, '0')}`}
        onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (!isNaN(h)) set({ time: h * 60 + (m || 0) }); }} /></>}
    </>;
  };
  const capSelect = (value: string, set: (v: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      <option value="">—</option>{capTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );

  return (
    <>
      <h3>Summary totals</h3>
      <p className="muted">
        Shown first in the Schedule summary: the chosen capacity type added up over every room with the tag, whether or not it is scheduled, unless “Only rooms with” picks an event or event group.
      </p>
      <table className="table">
        <thead><tr><th>Total</th><th>Rooms tagged</th><th>Capacity type</th><th>Only rooms with</th><th></th></tr></thead>
        <tbody>
          {state.summaryTotals.map((x, i) => (
            <tr key={x.id}>
              <td><input value={x.label} onChange={(e) => update((d) => { d.summaryTotals[i].label = e.target.value; })} /></td>
              <td><select value={x.tagId} onChange={(e) => update((d) => { d.summaryTotals[i].tagId = e.target.value; })}>
                {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></td>
              <td><select value={x.capType} onChange={(e) => update((d) => { d.summaryTotals[i].capType = e.target.value; })}>
                {capTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></td>
              <td><select value={x.eventIds?.[0] ? `e:${x.eventIds[0]}` : x.eventGroups?.[0] ? `g:${x.eventGroups[0]}` : ''}
                onChange={(e) => update((d) => {
                  const t = d.summaryTotals[i]; const v = e.target.value;
                  delete t.eventIds; delete t.eventGroups;
                  if (v.startsWith('e:')) t.eventIds = [v.slice(2)];
                  if (v.startsWith('g:')) t.eventGroups = [v.slice(2)];
                })}>
                <option value="">any room</option>
                <optgroup label="Event group">{groups.map((g) => <option key={g} value={`g:${g}`}>{g}</option>)}</optgroup>
                <optgroup label="Event">{state.events.map((ev) => <option key={ev.id} value={`e:${ev.id}`}>{ev.name}</option>)}</optgroup>
              </select></td>
              <td><ConfirmButton onConfirm={() => update((d) => { d.summaryTotals = d.summaryTotals.filter((y) => y.id !== x.id); })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><button disabled={!state.categories.length} title={state.categories.length ? undefined : 'Add a tag first'}
        onClick={() => update((d) => { d.summaryTotals.push({ id: uid('t'), label: 'New total', tagId: d.categories[0].id, capType: 'base' }); })}>+ Add total</button></p>

      <h3>Event totals</h3>
      <p className="muted">Events whose total (their capacity type added up over their rooms) is shown in the Schedule summary.</p>
      <p><EventChips state={state} ids={state.config.summaryEventIds} onChange={(ids) => update((d) => { d.config.summaryEventIds = ids; })} /></p>

      <h3>Proctors</h3>
      <p className="muted">Proctors needed at the busiest 15-minute slot: rooms in use for the chosen group's events, each counted once, with the min and ideal capacity types as the number of proctors per room.</p>
      <p><label><input type="checkbox" checked={!!P} onChange={(e) => update((d) => {
        if (!e.target.checked) { delete d.config.proctors; return; }
        d.config.proctors = { minCap: '', idealCap: '', bigType: '', pills: [newPill('Proctors', groups[0] ?? '')] };
      })} /> Show proctors in the summary</label></p>
      {P && <table className="table proctor-settings"><tbody>
        <tr><th>Proctors per room</th><td>min {capSelect(P.minCap, (v) => setP((p) => { p.minCap = v; }))}
          {' '}ideal {capSelect(P.idealCap, (v) => setP((p) => { p.idealCap = v; }))}</td></tr>
        <tr><th>Rooms listed one by one</th><td><select value={P.bigType} onChange={(e) => setP((p) => { p.bigType = e.target.value; })}>
          <option value="">none</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
          <span className="muted small"> each gets its own editable proctor count</span></td></tr>
        <tr><th>Pills</th><td>
          {P.pills.map((pill, pi) => (
            <div key={pill.id} className="pill-edit">
              <div><input value={pill.name} title="Pill name" onChange={(e) => setP((p) => { p.pills[pi].name = e.target.value; })} />
                {' '}from {boundSelect(pill.from, 'from', (b) => setP((p) => { if (b) p.pills[pi].from = b; else delete p.pills[pi].from; }))}
                {' '}to {boundSelect(pill.to, 'to', (b) => setP((p) => { if (b) p.pills[pi].to = b; else delete p.pills[pi].to; }))}
                {' '}<ConfirmButton label="Delete pill" onConfirm={() => setP((p) => { p.pills.splice(pi, 1); })} /></div>
              <div className="pill-line">counts <select value={pill.group} title="Event group this pill counts" onChange={(e) => setP((p) => { p.pills[pi].group = e.target.value; })}>
                {[...new Set([pill.group, ...groups])].map((g) => <option key={g} value={g}>{g || '—'}</option>)}</select> events
                {' '}leaving out <EventChips state={state} ids={pill.excludeIds} pool={state.events.filter((e) => e.group === pill.group).map((e) => e.id)}
                  onChange={(ids) => setP((p) => { p.pills[pi].excludeIds = ids; })} /></div>
              {pill.lines.map((l, li) => (
                <div key={li} className="pill-line">
                  <input value={l.label} placeholder="Line label" title="Line label (can be blank)" onChange={(e) => setP((p) => { p.pills[pi].lines[li].label = e.target.value; })} />
                  {' '}<select value={l.rooms ?? ''} title="Which rooms this line counts" onChange={(e) => setP((p) => {
                    const x = p.pills[pi].lines[li]; const v = e.target.value as 'listed' | 'others' | '';
                    if (v) x.rooms = v; else delete x.rooms;
                  })}>
                    <option value="">all rooms</option>
                    <option value="others" disabled={!P.bigType}>{P.bigType ? `all but ${P.bigType}` : 'all but listed rooms'}</option>
                    <option value="listed" disabled={!P.bigType}>only {P.bigType || 'listed rooms'}</option>
                  </select>
                  {' '}with <EventChips state={state} ids={l.eventIds} onChange={(ids) => setP((p) => { p.pills[pi].lines[li].eventIds = ids; })} />
                  {!l.eventIds.length && <span className="muted small"> rooms at the pill's busiest slot</span>}
                  <button className="chip-x" title="Remove line" onClick={() => setP((p) => { p.pills[pi].lines.splice(li, 1); })}>×</button>
                </div>
              ))}
              <button onClick={() => setP((p) => { p.pills[pi].lines.push({ label: '', eventIds: [] }); })}>+ Add line</button>
            </div>
          ))}
          <button onClick={() => setP((p) => { p.pills.push(newPill(`Proctors ${p.pills.length + 1}`, p.pills.at(-1)?.group ?? groups[0] ?? '')); })}>+ Add pill</button>
          <p className="muted small">Each pill shows min · ideal at the busiest slot of its group's events in its time range (whole day by default), then one line per count: the rooms used by the line's events in that range, by room type, with their proctors. “Large (names)” counts as Large.</p>
        </td></tr>
        <tr><th>Note</th><td><textarea rows={2} value={P.note ?? ''} onChange={(e) => setP((p) => { if (e.target.value) p.note = e.target.value; else delete p.note; })} /></td></tr>
      </tbody></table>}
    </>
  );
}
