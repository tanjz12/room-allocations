import { roomTypes, uid, type State } from '../lib/model';
import type { Proctors } from '../lib/config';
import { ConfirmButton, type ViewProps } from './common';

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
        d.config.proctors = { group: groups[0] ?? '', excludeIds: [], minCap: '', idealCap: '', bigType: '', smallLabel: 'Classrooms', rows: [] };
      })} /> Show proctors in the summary</label></p>
      {P && <table className="table proctor-settings"><tbody>
        <tr><th>Event group</th><td><select value={P.group} onChange={(e) => setP((p) => { p.group = e.target.value; })}>
          {[...new Set([P.group, ...groups])].map((g) => <option key={g} value={g}>{g || '—'}</option>)}</select></td></tr>
        <tr><th>Leave out</th><td><EventChips state={state} ids={P.excludeIds} pool={state.events.filter((e) => e.group === P.group).map((e) => e.id)}
          onChange={(ids) => setP((p) => { p.excludeIds = ids; })} /></td></tr>
        <tr><th>Pills</th><td>
          <select value={P.halves ? 'split' : 'one'} onChange={(e) => setP((p) => {
            if (e.target.value === 'one') { delete p.halves; delete p.splitPhaseId; } else p.halves = ['Morning', 'Afternoon'];
          })}><option value="one">one for the day</option><option value="split">two, before and after</option></select>
          {P.halves && <> <select value={P.splitPhaseId ?? ''} onChange={(e) => setP((p) => { if (e.target.value) p.splitPhaseId = e.target.value; else delete p.splitPhaseId; })}>
            <option value="">12:00 PM</option>{state.phases.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}</select>
            {' '}named <input value={P.halves[0]} onChange={(e) => setP((p) => { p.halves![0] = e.target.value; })} />
            {' '}and <input value={P.halves[1]} onChange={(e) => setP((p) => { p.halves![1] = e.target.value; })} /></>}
        </td></tr>
        <tr><th>Proctors per room</th><td>min {capSelect(P.minCap, (v) => setP((p) => { p.minCap = v; }))}
          {' '}ideal {capSelect(P.idealCap, (v) => setP((p) => { p.idealCap = v; }))}</td></tr>
        <tr><th>Rooms listed one by one</th><td><select value={P.bigType} onChange={(e) => setP((p) => { p.bigType = e.target.value; })}>
          <option value="">none</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
          <span className="muted small"> each gets its own editable proctor count</span></td></tr>
        <tr><th>Label for other rooms</th><td><input value={P.smallLabel} onChange={(e) => setP((p) => { p.smallLabel = e.target.value; })} />
          <span className="muted small"> counted by room type; “Large (names)” counts as Large</span></td></tr>
        {P.halves && <tr><th>Extra lines in “{P.halves[0]}”</th><td>
          {P.rows.map((row, i) => (
            <div key={i}><input value={row.label} onChange={(e) => setP((p) => { p.rows[i].label = e.target.value; })} />{' '}
              <EventChips state={state} ids={row.eventIds} onChange={(ids) => setP((p) => { p.rows[i].eventIds = ids; })} />
              <button className="chip-x" title="Remove line" onClick={() => setP((p) => { p.rows.splice(i, 1); })}>×</button></div>
          ))}
          <button onClick={() => setP((p) => { p.rows.push({ label: 'New line', eventIds: [] }); })}>+ Add line</button>
          <span className="muted small"> replace the room list with one line per set of events</span>
        </td></tr>}
        <tr><th>Note</th><td><textarea rows={2} value={P.note ?? ''} onChange={(e) => setP((p) => { if (e.target.value) p.note = e.target.value; else delete p.note; })} /></td></tr>
      </tbody></table>}
    </>
  );
}
