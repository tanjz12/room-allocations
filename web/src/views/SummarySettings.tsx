import { baseType, uid, type State } from '../lib/model';
import { Fragment, useState } from 'react';
import type { PillBound, ProctorPill, Proctors, RoomMatch } from '../lib/config';
import { ConfirmButton, type ViewProps } from './common';

const newPill = (name: string, group: string): ProctorPill => ({ id: uid('pill'), name, group, excludeIds: [], lines: [{ label: '', eventIds: [] }] });

type Suggestion = { key: string; label: string; hint?: string };

/** Small text box: typing shows up to 8 matching suggestions to pick (click, or arrows + Enter). */
function SuggestAdd({ options, onPick, placeholder, label }: { options: Suggestion[]; onPick: (key: string) => void; placeholder: string; label: string }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const needle = q.trim().toLowerCase();
  const starts = (o: Suggestion) => +!o.label.toLowerCase().startsWith(needle);
  const matches = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)).sort((x, y) => starts(x) - starts(y)).slice(0, 8) : [];
  const pick = (o: Suggestion) => { onPick(o.key); setQ(''); setHi(0); };
  return (
    <span className="suggest">
      <input value={q} placeholder={placeholder} aria-label={label} onChange={(e) => { setQ(e.target.value); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && matches[hi]) { e.preventDefault(); pick(matches[hi]); }
          else if (e.key === 'Escape') setQ('');
        }} />
      {needle && <span className="suggest-list" role="listbox">
        {matches.length ? matches.map((o, i) => (
          <button key={o.key} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
            onMouseDown={(e) => { e.preventDefault(); pick(o); }}><span className="lbl">{o.label}</span>{o.hint && <span className="muted small"> {o.hint}</span>}</button>
        )) : <span className="muted small">No matches</span>}
      </span>}
    </span>
  );
}

/** Chips for a list of event ids, with × to remove and a type-to-search box to add. */
function EventChips({ state, ids, onChange, pool }: { state: State; ids: string[]; onChange: (ids: string[]) => void; pool?: string[] }) {
  const name = (id: string) => state.events.find((e) => e.id === id)?.name ?? id;
  const free = state.events.filter((e) => !ids.includes(e.id) && (!pool || pool.includes(e.id)));
  return (
    <span className="tags-cell">
      {ids.map((id) => (
        <span key={id} className="chip tag-chip">{name(id)}
          <button className="chip-x" title={`Remove ${name(id)}`} onClick={() => onChange(ids.filter((x) => x !== id))}>×</button></span>
      ))}
      {free.length > 0 && <SuggestAdd placeholder="+ type an event" label="Add event" onPick={(id) => onChange([...ids, id])}
        options={free.map((e) => ({ key: e.id, label: e.name, hint: e.group || undefined }))} />}
    </span>
  );
}

const FIELD_NAMES: Record<RoomMatch['field'], string> = { type: 'room type', building: 'building', status: 'status', room: 'room' };

/** Chips for room matches; type in the box to see matching room types, buildings, statuses and room names. */
function RoomChips({ state, value, onChange }: { state: State; value: RoomMatch[]; onChange: (v: RoomMatch[]) => void }) {
  const label = (m: RoomMatch) => m.field === 'room' ? (state.rooms.find((r) => r.id === m.value)?.name ?? m.value) : m.value;
  const key = (m: RoomMatch) => m.field + '\0' + m.value;
  const all = new Map<string, RoomMatch>();
  const add = (m: RoomMatch) => { if (m.value && !value.some((v) => key(v) === key(m))) all.set(key(m), m); };
  for (const r of state.rooms) { add({ field: 'type', value: baseType(r.type) }); add({ field: 'type', value: r.type }); }
  for (const r of state.rooms) add({ field: 'building', value: r.building });
  for (const r of state.rooms) add({ field: 'status', value: r.status ?? '' });
  for (const r of state.rooms) add({ field: 'room', value: r.id });
  return (
    <span className="tags-cell room-chips">
      {value.map((m, i) => (
        <span key={i} className="chip tag-chip" title={FIELD_NAMES[m.field]}>{label(m)}<span className="muted small">&nbsp;{FIELD_NAMES[m.field]}</span>
          <button className="chip-x" title={`Remove ${label(m)}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></span>
      ))}
      <SuggestAdd placeholder="+ type to add" label="Add room type, building, status or room" onPick={(k) => onChange([...value, all.get(k)!])}
        options={[...all.values()].map((m) => ({ key: key(m), label: label(m), hint: FIELD_NAMES[m.field] }))} />
    </span>
  );
}

export default function SummarySettings({ state, update }: Pick<ViewProps, 'state' | 'update'>) {
  const groups = [...new Set([...(state.config.eventGroups ?? []), ...state.events.map((e) => e.group).filter(Boolean)])];
  const capTypes = state.capTypes;
  const P = state.config.proctors;
  const [draft, setDraft] = useState<ProctorPill | null>(null);
  const saved = draft && P?.pills.find((x) => x.id === draft.id);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const setD = (f: (d: ProctorPill) => void) => setDraft((d) => { if (!d) return d; const n = structuredClone(d); f(n); return n; });
  const leave = () => !dirty || confirm('Discard unsaved changes to this pill?');
  const openPillEdit = (pill: ProctorPill) => { if (leave()) setDraft(structuredClone(pill)); };
  const savePill = () => {
    if (!draft) return;
    const ok = new Set(state.events.map((e) => e.id));
    const d = structuredClone(draft);
    d.excludeIds = d.excludeIds.filter((id) => ok.has(id));
    d.lines.forEach((l) => { l.eventIds = l.eventIds.filter((id) => ok.has(id)); });
    setP((p) => { const i = p.pills.findIndex((x) => x.id === d.id); if (i >= 0) p.pills[i] = d; });
    setDraft(null);
  };
  const listedName = P?.listed.length ? P.listed.map((m) => m.field === 'room' ? (state.rooms.find((r) => r.id === m.value)?.name ?? m.value) : m.value).join(', ') : 'listed rooms';
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
        d.config.proctors = { minCap: '', idealCap: '', listed: [], pills: [newPill('Proctors', groups[0] ?? '')] };
      })} /> Show proctors in the summary</label></p>
      {P && <table className="table proctor-settings"><tbody>
        <tr><th>Proctors per room</th><td>min {capSelect(P.minCap, (v) => setP((p) => { p.minCap = v; }))}
          {' '}ideal {capSelect(P.idealCap, (v) => setP((p) => { p.idealCap = v; }))}</td></tr>
        <tr><th>Rooms listed one by one</th><td><RoomChips state={state} value={P.listed} onChange={(v) => setP((p) => { p.listed = v; })} />
          <div className="muted small">Rooms matching any of these each get their own editable proctor count.</div></td></tr>
        <tr><th>Pills</th><td>
          {P.pills.map((pill, pi) => (
            pill.id !== draft?.id || !draft ? (
            <div key={pill.id} className="pill-edit collapsed">
              <div><b>{pill.name || 'Untitled pill'}</b>{' '}
                <span className="muted small">{pill.group || '—'} events{pill.from || pill.to ? ', part of the day' : ', whole day'}{pill.lines.some((l) => l.label) ? ` · ${pill.lines.map((l) => l.label).filter(Boolean).join(', ')}` : ''}</span>
                {' '}<button onClick={() => openPillEdit(pill)}>Edit</button></div>
            </div>
            ) : (
            <div key={draft.id} className="pill-edit">
              <div><input value={draft.name} title="Pill name" onChange={(e) => setD((d) => { d.name = e.target.value; })} />
                {' '}from {boundSelect(draft.from, 'from', (b) => setD((d) => { if (b) d.from = b; else delete d.from; }))}
                {' '}to {boundSelect(draft.to, 'to', (b) => setD((d) => { if (b) d.to = b; else delete d.to; }))}
                {' '}<ConfirmButton label="Delete pill" onConfirm={() => { setP((p) => { p.pills.splice(pi, 1); }); setDraft(null); }} /></div>
              <div className="pill-line">counts <select value={draft.group} title="Event group this pill counts" onChange={(e) => setD((d) => { d.group = e.target.value; })}>
                {[...new Set([draft.group, ...groups])].map((g) => <option key={g} value={g}>{g || '—'}</option>)}</select> events
                {' '}leaving out <EventChips state={state} ids={draft.excludeIds} pool={state.events.filter((e) => e.group === draft.group).map((e) => e.id)}
                  onChange={(ids) => setD((d) => { d.excludeIds = ids; })} /></div>
              {draft.lines.map((l, li) => (
                <div key={li} className="pill-line">
                  <input value={l.label} placeholder="Line label" title="Line label (can be blank)" onChange={(e) => setD((d) => { d.lines[li].label = e.target.value; })} />
                  {' '}<select value={l.rooms ?? ''} title="Which rooms this line counts" onChange={(e) => setD((d) => {
                    const x = d.lines[li]; const v = e.target.value as 'listed' | 'others' | '';
                    if (v) x.rooms = v; else delete x.rooms;
                  })}>
                    <option value="">all rooms</option>
                    <option value="others" disabled={!P.listed.length}>all but {listedName}</option>
                    <option value="listed" disabled={!P.listed.length}>only {listedName}</option>
                  </select>
                  {' '}with <EventChips state={state} ids={l.eventIds} onChange={(ids) => setD((d) => { d.lines[li].eventIds = ids; })} />
                  {!l.eventIds.length && <span className="muted small"> rooms at the pill's busiest slot</span>}
                  <button className="chip-x" title="Remove line" onClick={() => setD((d) => { d.lines.splice(li, 1); })}>×</button>
                </div>
              ))}
              <button onClick={() => setD((d) => { d.lines.push({ label: '', eventIds: [] }); })}>+ Add line</button>
              <div className="pill-actions">
                <button className="primary" disabled={!dirty} onClick={savePill}>Save</button>
                {' '}<button onClick={() => { if (leave()) setDraft(null); }}>Collapse</button>
                {dirty && <span className="muted small"> Unsaved changes</span>}
              </div>
            </div>
          )))}
          <button onClick={() => { const np = newPill(`Proctors ${P.pills.length + 1}`, P.pills.at(-1)?.group ?? groups[0] ?? ''); if (!leave()) return; setP((p) => { p.pills.push(np); }); setDraft(structuredClone(np)); }}>+ Add pill</button>
          <p className="muted small">Each pill shows min · ideal at the busiest slot of its group's events in its time range (whole day by default), then one line per count: the rooms used by the line's events in that range, by room type, with their proctors. “Large (names)” counts as Large.</p>
        </td></tr>
        <tr><th>Note</th><td><textarea rows={2} value={P.note ?? ''} onChange={(e) => setP((p) => { if (e.target.value) p.note = e.target.value; else delete p.note; })} /></td></tr>
      </tbody></table>}
    </>
  );
}
