import { useState } from 'react';
import { ROOM_STATUSES, roomTypes, roomActive, roomCapacity, uid, type Category } from '../lib/model';
import { ConfirmButton, type ViewProps } from './common';
import ColorPicker from './ColorPicker';
import { usedColors } from '../lib/colors';

export default function RoomsView({ state, update }: ViewProps) {
  const [newCap, setNewCap] = useState('');
  const [msg, setMsg] = useState('');
  const types = roomTypes(state);
  const editable = state.capTypes.filter((c) => c.id !== 'base');
  const setCat = (id: string, patch: Partial<Category>) =>
    update((d) => { Object.assign(d.categories.find((c) => c.id === id)!, patch); });
  const tagIdsOf = (t: string) => state.typeTags[t] ?? [];
  const groupNames = [...new Set([...(state.config.eventGroups ?? []), ...state.events.map((e) => e.group).filter(Boolean)])];
  const setTypeTags = (t: string, ids: string[]) => update((d) => { d.typeTags[t] = ids; });

  const addCap = () => {
    const id = newCap.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!id || /^\d/.test(id) || state.capTypes.some((c) => c.id === id)) return setMsg('Pick a new unique name starting with a letter.');
    setMsg('');
    update((d) => { d.capTypes.push({ id, name: newCap.trim(), formulas: {} }); });
    setNewCap('');
  };

  return (
    <div className="page">
      <h2>Capacity formulas by room use</h2>
      <p className="muted">
        <b>[Raw]</b> is each room's own capacity, entered on the room below; other capacity types are worked out from it.
        Use <code>[Raw]</code> or another capacity type's id (e.g. <code>seats</code>) or bracketed name (e.g. <code>[Seats]</code>) and <code>floor(x, step)</code>, <code>ceil</code>, <code>round</code>, <code>min</code>, <code>max</code>, + − × ÷.
        Leave blank for no formula. A value typed into a room cell below overrides the formula for that room.
      </p>
      <table className="table formulas">
        <thead><tr><th>Capacity type</th><th>id</th>{types.map((t) => <th key={t}>{t}</th>)}<th></th></tr></thead>
        <tbody>
          {editable.map((c) => (
            <tr key={c.id}>
              <td><input value={c.name} onChange={(e) => update((d) => { d.capTypes.find((x) => x.id === c.id)!.name = e.target.value; })} /></td>
              <td><code>{c.id}</code></td>
              {types.map((t) => (
                <td key={t}><input className="mono" value={c.formulas[t] ?? ''} placeholder="—"
                  onChange={(e) => update((d) => { d.capTypes.find((x) => x.id === c.id)!.formulas[t] = e.target.value; })} /></td>
              ))}
              <td><button className="danger" onClick={() => {
                if (state.events.some((e) => e.capacityType === c.id)) return setMsg(`Events still use ${c.name}; change their capacity type first.`);
                if (state.summaryTotals.some((x) => x.capType === c.id)) return setMsg(`A summary total still uses ${c.name}; change it under Edit summary on Schedule first.`);
                if ([state.config.proctors?.minCap, state.config.proctors?.idealCap].includes(c.id)) return setMsg(`Proctors still use ${c.name}; change it under Edit summary on Schedule first.`);
                update((d) => { d.capTypes = d.capTypes.filter((x) => x.id !== c.id); d.rooms.forEach((r) => delete r.overrides[c.id]); });
              }}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><input value={newCap} placeholder="New capacity type name" onChange={(e) => setNewCap(e.target.value)} /> <button onClick={addCap}>+ Add capacity type</button>{msg && <span className="warn"> {msg}</span>}</p>

      <h2>Tags</h2>
      <p className="muted">Each tag applies to the room types listed with it, and, if event groups are picked, only to rooms whose scheduled events are all (or any, if chosen) in those groups (“also when nothing is scheduled” covers empty rooms). Tags also set the room sign box color. Tags color the floor plans and generated maps (when “color by tag” is chosen, using the first tag) and decide which rooms appear on the internal vs external maps (a room shows if any of its tags is marked for that map; untagged rooms show on internal maps only). Only rooms with status Yes are colored.</p>
      <table className="table">
        <thead><tr><th>Color</th><th>Name</th><th>Internal map</th><th>External map</th><th>Room types</th><th title="Blank: applies whatever is scheduled">if the room's event contains</th><th></th></tr></thead>
        <tbody>
          {state.categories.map((c) => (
            <tr key={c.id}>
              <td><ColorPicker value={c.color} existing={usedColors(state)} onChange={(x) => setCat(c.id, { color: x })} /></td>
              <td><input value={c.name} onChange={(x) => setCat(c.id, { name: x.target.value })} /></td>
              <td><input type="checkbox" checked={c.internal} onChange={(x) => setCat(c.id, { internal: x.target.checked })} /></td>
              <td><input type="checkbox" checked={c.external} onChange={(x) => setCat(c.id, { external: x.target.checked })} /></td>
              <td className="tags-cell">
                {types.filter((t) => tagIdsOf(t).includes(c.id)).map((t) => (
                  <span key={t} className="chip tag-chip">{t}
                    <button className="chip-x" title={`Remove ${t}`} onClick={() => setTypeTags(t, tagIdsOf(t).filter((x) => x !== c.id))}>×</button></span>
                ))}
                {types.some((t) => !tagIdsOf(t).includes(c.id)) && (
                  <select className="tag-add" title="Add room type" value="" onChange={(x) => x.target.value && setTypeTags(x.target.value, [...tagIdsOf(x.target.value), c.id])}>
                    <option value="" hidden>+</option>
                    {types.filter((t) => !tagIdsOf(t).includes(c.id)).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </td>
              <td className="hide-on">
                {!!c.eventGroups?.length && <select className="event-match" value={c.eventMatch ?? 'all'} onChange={(x) => setCat(c.id, { eventMatch: x.target.value === 'any' ? 'any' : undefined })}>
                  <option value="all">all events in:</option><option value="any">any event in:</option></select>}
                {groupNames.map((g) => (
                  <label key={g}><input type="checkbox" checked={!!c.eventGroups?.includes(g)}
                    onChange={(x) => setCat(c.id, { eventGroups: x.target.checked ? [...(c.eventGroups ?? []), g] : (c.eventGroups ?? []).filter((h) => h !== g) })} />{g}</label>
                ))}
                {!!c.eventGroups?.length && <label className="when-empty"><input type="checkbox" checked={!!c.whenEmpty} onChange={(x) => setCat(c.id, { whenEmpty: x.target.checked || undefined })} />also when nothing is scheduled</label>}
              </td>
              <td><ConfirmButton onConfirm={() => update((d) => {
                d.categories = d.categories.filter((x) => x.id !== c.id);
                for (const t of Object.keys(d.typeTags)) d.typeTags[t] = d.typeTags[t].filter((x) => x !== c.id);
              })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><button onClick={() => update((d) => { d.categories.push({ id: uid('c'), name: 'New tag', color: '#aaaaaa', internal: true, external: false }); })}>+ Add tag</button></p>

      <h2>Rooms</h2>
      <p className="muted"><span className="ovr-key">Highlighted</span> cells are overrides. Clear a cell to go back to the formula. Only rooms set to <b>Yes</b> appear on the Schedule and floor plans and count toward capacity and proctors.</p>
      <table className="table rooms">
        <thead><tr><th>Room</th><th title="Only Yes rooms are scheduled or counted">Status</th><th>Building</th><th>Room type</th><th>[Raw]</th>{editable.map((c) => <th key={c.id}>{c.name}</th>)}</tr></thead>
        <tbody>
          {state.rooms.map((r) => (
            <tr key={r.id} className={roomActive(r) ? undefined : 'inactive'}>
              <td><b>{r.name}</b></td>
              <td><select value={r.status ?? ''} onChange={(e) => update((d) => { d.rooms.find((x) => x.id === r.id)!.status = e.target.value; })}>
                <option value="">—</option>{ROOM_STATUSES.map((x) => <option key={x}>{x}</option>)}</select></td>
              <td>{r.building}</td>
              <td><select value={r.type} onChange={(e) => update((d) => { d.rooms.find((x) => x.id === r.id)!.type = e.target.value; })}>
                {types.map((t) => <option key={t}>{t}</option>)}</select></td>
              <td><input type="number" className="numin" value={r.base ?? ''} placeholder="—"
                onChange={(e) => update((d) => { d.rooms.find((x) => x.id === r.id)!.base = e.target.value === '' ? null : +e.target.value; })} /></td>
              {editable.map((c) => {
                const res = roomCapacity(state, r, c.id);
                const ovr = res.source === 'override';
                return (
                  <td key={c.id} className={ovr ? 'ovr' : ''} title={res.error ?? (ovr ? 'Override' : 'From formula')}>
                    <input type="number" className="numin" value={ovr ? res.value! : ''} placeholder={res.value != null ? String(res.value) : res.error ? '!' : '—'}
                      onChange={(e) => update((d) => {
                        const o = d.rooms.find((x) => x.id === r.id)!.overrides;
                        if (e.target.value === '') delete o[c.id]; else o[c.id] = +e.target.value;
                      })} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
