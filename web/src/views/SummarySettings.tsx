import { uid, type State, alignPhases } from '../lib/model';
import { useState } from 'react';
import type { ProctorCapPill, SummaryRow } from '../lib/config';
import { ConfirmButton, Swatch, type ViewProps } from './common';

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
export function EventChips({ state, ids, onChange, pool }: { state: State; ids: string[]; onChange: (ids: string[]) => void; pool?: string[] }) {
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

const KIND_NAMES: Record<SummaryRow['kind'], string> = { cap: 'Capacity total', event: 'Event total', proctors: 'Proctors' };

export default function SummarySettings({ state, update }: Pick<ViewProps, 'state' | 'update'>) {
  const groups = [...new Set([...(state.config.eventGroups ?? []), ...state.events.map((e) => e.group).filter(Boolean)])];
  const types = [...new Set([...state.config.roomTypes, ...state.rooms.map((r) => r.type)])].filter(Boolean);
  const rows = state.config.summary ?? [];
  const caps = state.config.proctorCaps ?? {};
  const pills = caps.pills ?? [];
  const set = (id: string, f: (x: SummaryRow) => void) => update((d) => { const x = d.config.summary?.find((y) => y.id === id); if (x) f(x); });
  const add = (x: SummaryRow) => update((d) => { (d.config.summary ??= []).push(x); });
  const move = (i: number, j: number) => update((d) => { const a = d.config.summary!; [a[i], a[j]] = [a[j], a[i]]; });
  const setPills = (f: (a: ProctorCapPill[]) => void) => update((d) => { const c = (d.config.proctorCaps ??= {}); f((c.pills ??= [])); });
  const setListed = (v: string[]) => update((d) => { (d.config.proctorCaps ??= {}).listed = v; });
  const evName = (id: string) => state.events.find((e) => e.id === id)?.name ?? '';
  const phaseLabel = (ids: string[]) => `${ids.map((id) => state.phases.find((p) => p.id === id)?.name ?? '').join(' + ')} proctors`;
  const setPhases = (id: string, ids: string[]) => set(id, (y) => { if (y.kind !== 'proctors') return; if (y.label === phaseLabel(y.phaseIds)) y.label = phaseLabel(ids); y.phaseIds = ids; });
  const capSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {!state.capTypes.some((c) => c.id === value) && <option value={value}>—</option>}
      {state.capTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
  const detail = (x: SummaryRow) => {
    if (x.kind === 'cap') {
      const tags = x.tags ?? [];
      const setCap = (f: (y: Extract<SummaryRow, { kind: 'cap' }>) => void) => set(x.id, (y) => { if (y.kind === 'cap') f(y); });
      const freeTags = state.categories.filter((c) => !tags.includes(c.id));
      const freeTypes = types.filter((t) => !x.types.includes(t));
      const groups = [...new Set(state.events.map((e) => e.group).filter(Boolean))];
      return <>
        {capSelect(x.capType, (v) => setCap((y) => { y.capType = v; }), 'Capacity type')} of every room with{' '}
        <span className="tags-cell">
          {tags.map((id) => { const c = state.categories.find((z) => z.id === id); return (
            <span key={id} className="chip tag-chip" title="Tag">{c && <Swatch color={c.color} />}{c?.name ?? '—'}
              <button className="chip-x" title="Remove tag" onClick={() => setCap((y) => { y.tags = (y.tags ?? []).filter((z) => z !== id); })}>×</button></span>
          ); })}
          {x.types.map((t) => (
            <span key={t} className="chip tag-chip" title="Room type">type {t}
              <button className="chip-x" title={`Remove ${t}`} onClick={() => setCap((y) => { y.types = y.types.filter((z) => z !== t); })}>×</button></span>
          ))}
          {(freeTags.length > 0 || freeTypes.length > 0) && <select value="" aria-label="Add tag or room type" onChange={(e) => { const v = e.target.value; if (v.startsWith('c:')) setCap((y) => { y.tags = [...(y.tags ?? []), v.slice(2)]; }); else if (v.startsWith('t:')) setCap((y) => { y.types.push(v.slice(2)); }); }}>
            <option value="">+ tag / type</option>
            {freeTags.length > 0 && <optgroup label="Tags">{freeTags.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>}
            {freeTypes.length > 0 && <optgroup label="Room types">{freeTypes.map((t) => <option key={t} value={`t:${t}`}>{t}</option>)}</optgroup>}
          </select>}
        </span>
        {' '}used for <select value={x.group ?? ''} aria-label="Used for" onChange={(e) => { const v = e.target.value; setCap((y) => { if (v) y.group = v; else delete y.group; }); }}>
          <option value="">anything</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </>;
    }
    if (x.kind === 'event') return <>
      <select value={x.eventId} aria-label="Event" onChange={(e) => { const v = e.target.value; set(x.id, (y) => { if (y.kind !== 'event') return; if (y.label === evName(y.eventId)) y.label = evName(v); y.eventId = v; }); }}>
        {!state.events.some((e) => e.id === x.eventId) && <option value={x.eventId}>—</option>}
        {state.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select> capacity of every room it is in
    </>;
    return <>
      proctors of rooms with a{' '}
      <select value={x.group} aria-label="Event group" onChange={(e) => { const v = e.target.value; set(x.id, (y) => { if (y.kind === 'proctors') y.group = v; }); }}>
        {[...new Set([x.group, ...groups])].map((g) => <option key={g} value={g}>{g || '—'}</option>)}
      </select> event starting in{' '}
      <span className="tags-cell">
        {x.phaseIds.map((id) => (
          <span key={id} className="chip tag-chip">{state.phases.find((p) => p.id === id)?.name ?? '—'}
            <button className="chip-x" title="Remove phase" onClick={() => setPhases(x.id, x.phaseIds.filter((z) => z !== id))}>×</button></span>
        ))}
        {alignPhases(state).some((p) => !x.phaseIds.includes(p.id)) && <select value="" aria-label="Add phase" onChange={(e) => { const v = e.target.value; if (v) setPhases(x.id, [...x.phaseIds, v]); }}>
          <option value="">+ phase</option>{alignPhases(state).filter((p) => !x.phaseIds.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
      </span>{x.phaseIds.length > 1 && ' (largest phase)'}
    </>;
  };
  const lastGroup = [...rows].reverse().find((x) => x.kind === 'proctors')?.group ?? groups[0] ?? '';

  return (
    <>
      <p className="muted">Shown in this order in the summary, and in column F of the Google Sheet written by Save to Drive, where each one is a formula. Only rooms set to Yes count.</p>
      {rows.length > 0 && <table className="table summary-rows">
        <thead><tr><th>Label</th><th>Kind</th><th>Adds up</th><th></th></tr></thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={x.id}>
              <td><input value={x.label} aria-label="Label" onChange={(e) => { const v = e.target.value; set(x.id, (y) => { y.label = v; }); }} /></td>
              <td className="muted nowrap">{KIND_NAMES[x.kind]}</td>
              <td>{detail(x)}</td>
              <td className="nowrap">
                <button disabled={!i} title="Move up" onClick={() => move(i, i - 1)}>↑</button>
                <button disabled={i === rows.length - 1} title="Move down" onClick={() => move(i, i + 1)}>↓</button>{' '}
                <ConfirmButton onConfirm={() => update((d) => { d.config.summary = d.config.summary?.filter((y) => y.id !== x.id); })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>}
      <p>
        <button disabled={!types.length} onClick={() => add({ id: uid('sum'), kind: 'cap', label: 'New total', capType: 'base', types: [] })}>+ Capacity total</button>{' '}
        <button disabled={!state.events.length} onClick={() => add({ id: uid('sum'), kind: 'event', label: state.events[0].name, eventId: state.events[0].id })}>+ Event total</button>{' '}
        <button disabled={!alignPhases(state).length} onClick={() => add({ id: uid('sum'), kind: 'proctors', label: phaseLabel([alignPhases(state)[0].id]), phaseIds: [alignPhases(state)[0].id], group: lastGroup })}>+ Proctors</button>
      </p>
      {rows.some((x) => x.kind === 'proctors') && <p>Proctors per room:{' '}
        <span className="tags-cell">
          {pills.map((p, i) => (
            <span key={i} className="chip tag-chip proc-pill">
              {capSelect(p.capType, (v) => setPills((a) => { a[i].capType = v; }), 'Capacity type')}
              <input className="pill-name" value={p.name} size={Math.max(2, p.name.length)} placeholder="name" aria-label="Name shown after the number" title="Name shown after the number"
                onChange={(e) => { const v = e.target.value; setPills((a) => { a[i].name = v; }); }} />
              <button className="chip-x" title={`Remove ${p.name || 'pill'}`} onClick={() => setPills((a) => { a.splice(i, 1); })}>×</button></span>
          ))}
          <select value="" aria-label="Add a proctor pill" onChange={(e) => { const v = e.target.value; if (v) setPills((a) => { a.push({ capType: v, name: state.capTypes.find((c) => c.id === v)?.name ?? '' }); }); }}>
            <option value="">+ pill</option>{state.capTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </span>
        {' '}· list one by one, with editable counts:{' '}
        <span className="tags-cell">
          {(caps.listed ?? []).map((t) => (
            <span key={t} className="chip tag-chip">{t}
              <button className="chip-x" title={`Remove ${t}`} onClick={() => setListed((caps.listed ?? []).filter((z) => z !== t))}>×</button></span>
          ))}
          {types.some((t) => !caps.listed?.includes(t)) && <select value="" aria-label="List rooms of type one by one" onChange={(e) => { const v = e.target.value; if (v) setListed([...(caps.listed ?? []), v]); }}>
            <option value="">+ type</option>{types.filter((t) => !caps.listed?.includes(t)).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>}
        </span></p>}
    </>
  );
}
