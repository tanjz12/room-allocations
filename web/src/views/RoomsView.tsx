import { useState } from 'react';
import { roomStatuses, textColor, roomTypes, roomActive, roomCapacity, ruleType, uid, type Category, type Room, type State, type Updater } from '../lib/model';
import { ConfirmButton, type ViewProps } from './common';
import ColorPicker from './ColorPicker';
import { usedColors, defaultColor } from '../lib/colors';

const SHEET_FILL = '#d9ead3';

function renameType(d: State, from: string, to: string) {
  const key = <T,>(o: Record<string, T> | undefined) => { if (o && from in o) { o[to] = o[from]; delete o[from]; } };
  d.rooms.forEach((r) => { if (r.type === from) r.type = to; });
  d.config.roomTypes = d.config.roomTypes.map((t) => (t === from ? to : t));
  key(d.typeTags); key(d.config.typeRules); key(d.config.sheetTypeFill);
  d.capTypes.forEach((c) => key(c.formulas));
  d.config.summary?.forEach((x) => { if (x.kind === 'cap') x.types = x.types.map((t) => (t === from ? to : t)); });
  if (d.config.proctorCaps?.listed) d.config.proctorCaps.listed = d.config.proctorCaps.listed.map((t) => (t === from ? to : t));
}

/** Text box that saves on Enter or when it loses focus. */
function CommitInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = () => { if (draft !== null && draft !== value) onCommit(draft.trim()); setDraft(null); };
  return <input {...rest} value={draft ?? value} onChange={(e) => setDraft(e.target.value)} onBlur={done}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setDraft(null); }} />;
}

/** Status dropdown colored like its chip in the source Google Sheet. */
function StatusSelect({ statuses, value, onChange }: { statuses: { name: string; color: string }[]; value: string; onChange: (v: string) => void }) {
  const style = (c?: string) => (c ? { background: c, color: textColor(c) } : { background: '#fff', color: '#222' });
  return (
    <select className="status-sel" style={style(statuses.find((x) => x.name === value)?.color)} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" style={style()}>—</option>
      {statuses.map((x) => <option key={x.name} value={x.name} style={style(x.color)}>{x.name}</option>)}
    </select>
  );
}

/** A room's type: pick or type a new one; with type rules, clear it to follow the rules. */
function TypeCell({ state, update, r, rules }: { state: State; update: Updater; r: Room; rules: boolean }) {
  const auto = rules && !!r.typeAuto;
  const res = rules ? ruleType(state, r) : {};
  const commit = (v: string) => update((d) => {
    const x = d.rooms.find((y) => y.id === r.id)!;
    if (!v) { if (rules) x.typeAuto = true; return; }
    x.type = v; delete x.typeAuto;
    if (!d.config.roomTypes.includes(v)) d.config.roomTypes.push(v);
  });
  return (
    <td className={rules && !auto ? 'ovr' : ''} title={auto ? (res.error ?? 'From the type rules') : rules ? 'Set by hand. Clear to use the type rules' : undefined}>
      <CommitInput className="type-in" list="room-types" value={auto ? '' : r.type} placeholder={auto ? (res.type ?? r.type) : ''}
        onCommit={commit} aria-label={`Room type of ${r.name}`} />
    </td>
  );
}

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
  const rules = Object.values(state.config.typeRules ?? {}).some((x) => x.trim());
  const [newType, setNewType] = useState('');
  const [typeMsg, setTypeMsg] = useState('');
  const [ctl, setCtl] = useState<'types' | 'tags' | 'status' | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const statuses = roomStatuses(state);
  const addStatus = () => {
    const v = newStatus.trim();
    if (!v || statuses.some((z) => z.name === v)) return setStatusMsg(v ? `${v} already exists.` : 'A status needs a name.');
    setStatusMsg(''); setNewStatus('');
    update((d) => { (d.config.roomStatuses ??= structuredClone(statuses)).push({ name: v, color: defaultColor(d) }); });
  };
  const addType = () => {
    const t = newType.trim();
    if (!t || types.includes(t)) return setTypeMsg('Pick a new type name.');
    setTypeMsg('');
    update((d) => { d.config.roomTypes = [...roomTypes(d), t]; });
    setNewType('');
  };
  const [newRoom, setNewRoom] = useState({ name: '', building: '' });
  const [roomMsg, setRoomMsg] = useState('');
  const buildings = [...new Set(state.rooms.map((r) => r.building).filter(Boolean))].sort();
  const addRoom = () => {
    const name = newRoom.name.trim();
    if (!name) return setRoomMsg('A room needs a name.');
    if (state.rooms.some((r) => r.name === name)) return setRoomMsg(`${name} already exists.`);
    const stem = name.replace(/[^A-Za-z0-9]+/g, '') || 'Room';
    let id = stem, n = 2;
    while (state.rooms.some((r) => r.id === id)) id = `${stem}${n++}`;
    setRoomMsg('');
    update((d) => { d.rooms.push({ id, name, building: newRoom.building.trim(), type: types[0] ?? 'Other', base: null, overrides: {}, status: 'Yes', ...(rules ? { typeAuto: true } : {}) }); });
    setNewRoom({ name: '', building: '' });
  };
  const setRoomField = (id: string, k: 'name' | 'building', v: string) => update((d) => { d.rooms.find((x) => x.id === id)![k] = v; });
  const moveType = (i: number, by: number) => update((d) => {
    const l = roomTypes(d); const j = i + by;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]]; d.config.roomTypes = l;
  });

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
                if (state.config.summary?.some((x) => x.kind === 'cap' && x.capType === c.id) || state.config.proctorCaps?.pills?.some((p) => p.capType === c.id)) return setMsg(`The summary still uses ${c.name}; change it under Edit summary on Schedule first.`);
                update((d) => { d.capTypes = d.capTypes.filter((x) => x.id !== c.id); d.rooms.forEach((r) => delete r.overrides[c.id]); });
              }}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><input value={newCap} placeholder="New capacity type name" onChange={(e) => setNewCap(e.target.value)} /> <button onClick={addCap}>+ Add capacity type</button>{msg && <span className="warn"> {msg}</span>}</p>

      <div className="ctl-toggles">
        {([['types', 'Room types'], ['tags', 'Tags'], ['status', 'Room statuses']] as const).map(([k, label]) => (
          <button key={k} className="group-toggle" aria-expanded={ctl === k} onClick={() => setCtl(ctl === k ? null : k)}>{ctl === k ? '▾' : '▸'} <b>{label}</b></button>
        ))}
      </div>
      {ctl === 'types' && (<>
      <p className="muted">
        A room's type picks its capacity formulas and tags. A rule sets the type from the room's <code>[Raw]</code>, e.g. <code>[Raw] &gt;= 150</code> or <code>[Raw] &gt;= 40 and [Raw] &lt; 150</code>;
        rules are checked top to bottom and the first true one wins. Clear a room's type below to use the rules; a type picked or typed there overrides them.
        Sheet color fills the type's room headers in the Google Sheet.
      </p>
      <table className="table room-types">
        <thead><tr><th>Type</th><th>Rule</th><th>Sheet color</th><th>Rooms</th><th></th><th></th></tr></thead>
        <tbody>
          {types.map((t, i) => {
            const n = state.rooms.filter((r) => r.type === t).length;
            return (
              <tr key={t}>
                <td><CommitInput value={t} aria-label="Type name" onCommit={(v) => {
                  if (!v || types.includes(v)) return setTypeMsg(v ? `${v} already exists.` : 'A type needs a name.');
                  setTypeMsg(''); update((d) => renameType(d, t, v));
                }} /></td>
                <td><input className="mono" value={state.config.typeRules?.[t] ?? ''} placeholder="—" aria-label={`Rule for ${t}`}
                  onChange={(e) => { const v = e.target.value; update((d) => { const m = (d.config.typeRules ??= {}); if (v) m[t] = v; else delete m[t]; }); }} /></td>
                <td><ColorPicker value={state.config.sheetTypeFill?.[t] ?? SHEET_FILL} existing={usedColors(state)}
                  onChange={(x) => update((d) => { (d.config.sheetTypeFill ??= {})[t] = x; })} /></td>
                <td>{n}</td>
                <td className="nowrap"><button title="Move up" disabled={!i} onClick={() => moveType(i, -1)}>↑</button><button title="Move down" disabled={i === types.length - 1} onClick={() => moveType(i, 1)}>↓</button></td>
                <td><button className="danger" disabled={n > 0} title={n ? `${n} rooms use ${t}` : undefined} onClick={() => update((d) => {
                  d.config.roomTypes = d.config.roomTypes.filter((x) => x !== t);
                  delete d.typeTags[t]; delete d.config.typeRules?.[t]; delete d.config.sheetTypeFill?.[t];
                  d.capTypes.forEach((c) => delete c.formulas[t]);
                })}>Delete</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p><input value={newType} placeholder="New room type" onChange={(e) => setNewType(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addType()} /> <button onClick={addType}>+ Add room type</button>{typeMsg && <span className="warn"> {typeMsg}</span>}</p>
      </>)}
      <datalist id="room-types">{types.map((t) => <option key={t} value={t} />)}</datalist>

      {ctl === 'tags' && (<>
      <p className="muted">Tags are for coloring maps. You can choose whether a color shows on the internal map or the external map. The tag of a room is determined by its events. Only rooms with status Yes are colored on the map.</p>
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
      <p><button onClick={() => update((d) => { d.categories.push({ id: uid('c'), name: 'New tag', color: defaultColor(d), internal: true, external: false }); })}>+ Add tag</button></p>
      </>)}

      {ctl === 'status' && (<>
      <p className="muted">Status options for the Rooms table, colored like the dropdown in the rooms Google Sheet. Only rooms set to <b>Yes</b> are scheduled and counted, so Yes can't be renamed or deleted.</p>
      <table className="table">
        <thead><tr><th>Color</th><th>Name</th><th>Rooms</th><th></th></tr></thead>
        <tbody>
          {statuses.map((st) => {
            const n = state.rooms.filter((r) => r.status === st.name).length;
            const yes = st.name === 'Yes';
            return (
              <tr key={st.name}>
                <td><ColorPicker value={st.color} existing={usedColors(state)} onChange={(x) => update((d) => { const y = d.config.roomStatuses?.find((z) => z.name === st.name); if (y) y.color = x; })} /></td>
                <td><CommitInput value={st.name} disabled={yes} title={yes ? 'Only Yes rooms are scheduled and counted' : undefined} aria-label={`Status name ${st.name}`} onCommit={(v) => {
                  if (!v || statuses.some((z) => z.name === v)) return setStatusMsg(v ? `${v} already exists.` : 'A status needs a name.');
                  setStatusMsg(''); update((d) => {
                    const y = d.config.roomStatuses?.find((z) => z.name === st.name); if (y) y.name = v;
                    d.rooms.forEach((r) => { if (r.status === st.name) r.status = v; });
                  });
                }} /></td>
                <td>{n}</td>
                <td><button className="danger" disabled={yes || n > 0} title={yes ? 'Yes is needed for scheduling' : n ? `${n} rooms use ${st.name}` : undefined}
                  onClick={() => update((d) => { d.config.roomStatuses = d.config.roomStatuses?.filter((z) => z.name !== st.name); })}>Delete</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p><input value={newStatus} placeholder="New status" onChange={(e) => setNewStatus(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStatus()} /> <button onClick={addStatus}>+ Add status</button>{statusMsg && <span className="warn"> {statusMsg}</span>}</p>
      </>)}

      <h2>Rooms</h2>
      <p className="muted"><span className="ovr-key">Highlighted</span> cells are overrides (room types only once a type rule exists). Clear a cell to go back to the formula. Only rooms set to <b>Yes</b> appear on the Schedule and floor plans and count toward capacity and proctors.</p>
      <table className="table rooms">
        <thead><tr><th>Room</th><th title="Only Yes rooms are scheduled or counted">Status</th><th>Building</th><th>Room type</th><th>[Raw]</th>{editable.map((c) => <th key={c.id}>{c.name}</th>)}<th></th></tr></thead>
        <tbody>
          {state.rooms.map((r) => (
            <tr key={r.id} className={roomActive(r) ? undefined : 'inactive'}>
              <td><CommitInput className="room-name-in" value={r.name} aria-label={`Name of ${r.name}`} onCommit={(v) => {
                if (!v) return setRoomMsg('A room needs a name.');
                setRoomMsg(''); setRoomField(r.id, 'name', v);
              }} /></td>
              <td><StatusSelect statuses={statuses} value={r.status ?? ''} onChange={(v) => update((d) => { d.rooms.find((x) => x.id === r.id)!.status = v; })} /></td>
              <td><CommitInput className="type-in" list="room-buildings" value={r.building} aria-label={`Building of ${r.name}`} onCommit={(v) => setRoomField(r.id, 'building', v)} /></td>
              <TypeCell state={state} update={update} r={r} rules={rules} />
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
              <td><ConfirmButton onConfirm={() => update((d) => {
                d.rooms = d.rooms.filter((x) => x.id !== r.id);
                d.blocks = d.blocks.filter((b) => b.roomId !== r.id);
                d.config.maps.forEach((m) => { if (m.keepOrig) m.keepOrig = m.keepOrig.filter((x) => x !== r.id); });
              })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="room-buildings">{buildings.map((b) => <option key={b} value={b} />)}</datalist>
      <p><input value={newRoom.name} placeholder="New room name" aria-label="New room name" onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addRoom()} />{' '}
        <input list="room-buildings" value={newRoom.building} placeholder="Building" aria-label="New room building" onChange={(e) => setNewRoom({ ...newRoom, building: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addRoom()} />{' '}
        <button onClick={addRoom}>+ Add room</button>{roomMsg && <span className="warn"> {roomMsg}</span>}</p>
      <p className="muted small">Deleting a room also removes its scheduled events. Floor plan shapes matched to it then show as “Not in rooms list”.</p>

      <h3>Buildings</h3>
      <p className="muted small">Worked out from the Building column above. Renaming a building here renames it for all its rooms.</p>
      <table className="buildings">
        <thead><tr><th>Building</th><th>Rooms</th><th>Room list</th></tr></thead>
        <tbody>
          {buildings.map((b) => {
            const rs = state.rooms.filter((r) => r.building === b);
            return (
              <tr key={b}>
                <td><CommitInput className="room-name-in" value={b} aria-label={`Building name ${b}`} onCommit={(v) => {
                  if (!v || v === b) return;
                  update((d) => {
                    d.rooms.forEach((r) => { if (r.building === b) r.building = v; });
                  });
                }} /></td>
                <td>{rs.length}</td>
                <td className="small">{rs.map((r) => r.name).join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
