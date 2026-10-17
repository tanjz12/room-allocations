import { useEffect, useRef, useState } from 'react';
import type { Font } from 'opentype.js';
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { eventGroups, highlightTotals, roomActive, clashMessage, clashWith, eventAt, fmtTime, uid, roomCapacity, roomEventsAt, textColor, type EventT } from '../lib/model';
import { allMapRoomIds, renderMap, roomEntry, GROUP_KEY, type ColorBy, type Entry, type Variant } from '../lib/maps';
import { loadFont } from '../lib/text';
import { ConfirmButton, Swatch, TimePicker, type ViewProps } from './common';
import MapUpload from './MapUpload';

export function useFont() {
  const [font, setFont] = useState<Font | null>(null);
  useEffect(() => { loadFont().then(setFont); }, []);
  return font;
}

export default function MapView({ state, update, time, setTime }: ViewProps) {
  const font = useFont();
  const hl = state.config.highlight;
  const [uploading, setUploading] = useState(false);
  const [colorBy, setColorBy] = useState<ColorBy>('event');
  const [showSel, setShow] = useState<'app' | 'focus'>('focus');
  const show = !hl ? 'app' : showSel;
  const variant: Variant = 'app';
  const gcs = state.config.mapGroupColors ?? [];
  const groups = [...new Set([...eventGroups(state), ...state.events.map((e) => e.group)])].filter((g) => g && state.events.some((e) => e.group === g));
  const addGroup = (g: string) => update((d) => {
    d.config.mapGroupColors = [...(d.config.mapGroupColors ?? []), { group: g, color: d.events.find((e) => e.group === g)?.color ?? '#4a7fc1' }];
  });
  const removeGroup = (g: string) => update((d) => {
    d.config.mapGroupColors = (d.config.mapGroupColors ?? []).filter((x) => x.group !== g);
    if (!d.config.mapGroupColors.length) delete d.config.mapGroupColors;
  });
  const only = show === 'focus' && hl ? (e: EventT) => hl.eventIds.includes(e.id) : undefined;
  const [hover, setHover] = useState<{ x: number; y: number; id: string } | null>(null);
  const onMap = allMapRoomIds(state);
  const standalone = state.rooms.filter((r) => !onMap.has(r.id) && roomActive(r));

  const legend = new Map<string, Entry>();
  for (const r of state.rooms) {
    const e = roomEntry(state, r.id, time, colorBy, variant, only);
    if (e) legend.set(e.key, e);
  }
  const indivLegend = only && colorBy === 'event' ? highlightTotals(state) : null;
  const indivIds = new Set(indivLegend?.items.map((x) => x.e.id));
  const projected = state.projectedIndiv || hl?.projectedDefault || 0;
  const pct = (n: number) => (projected ? Math.round((n / projected) * 100) : 0);
  const indivRows = indivLegend?.items ?? [];
  const indivPct = indivRows.reduce((a, x) => a + pct(x.total), 0);
  const rendered = state.config.maps.map((m) => ({ b: m.name, svg: renderMap(m, state, time, colorBy, variant, font, only, state.mapColors.unknown, state.mapColors.other, only ? state.mapColors.focusUnused : undefined).svg }));
  const sEntries = standalone.map((r) => ({ r, e: roomEntry(state, r.id, time, colorBy, variant, only) }));
  const setColor = (key: string, color: string) => update((d) => {
    if (key.startsWith(GROUP_KEY)) { const g = d.config.mapGroupColors?.find((x) => GROUP_KEY + x.group === key); if (g) g.color = color; return; }
    const x = colorBy === 'category' ? d.categories.find((c) => c.id === key) : d.events.find((e) => e.id === key);
    if (x) x.color = color;
  });

  const onMove = (ev: React.MouseEvent) => {
    const el = (ev.target as Element).closest('[data-room]');
    setHover(el ? { x: ev.clientX, y: ev.clientY, id: el.getAttribute('data-room')! } : null);
  };
  const hRoom = hover && state.rooms.find((r) => r.id === hover.id && roomActive(r));
  const [edit, setEdit] = useState<{ x: number; y: number; id: string } | null>(null);
  const editRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!edit) return;
    const down = (e: MouseEvent) => { if (!editRef.current?.contains(e.target as Node)) setEdit(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setEdit(null); };
    const scroll = (e: Event) => { if (!editRef.current?.contains(e.target as Node)) setEdit(null); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); document.removeEventListener('scroll', scroll, true); };
  }, [edit]);
  const onClick = (ev: React.MouseEvent) => {
    const el = (ev.target as Element).closest('[data-room]');
    if (!el) return;
    setHover(null);
    setEdit({ x: Math.min(ev.clientX + 10, window.innerWidth - 330), y: Math.min(ev.clientY + 10, window.innerHeight - 200), id: el.getAttribute('data-room')! });
  };
  const eRoom = edit && state.rooms.find((r) => r.id === edit.id && roomActive(r));
  const eEvents = eRoom ? roomEventsAt(state, eRoom.id, time) : [];
  const choices = state.events.filter((e) => eventAt(e, time)).sort((a, b) => a.name.localeCompare(b.name));
  const optLabel = (e: EventT) => `${e.name} (${fmtTime(e.start)}–${fmtTime(e.end)})`;
  const [warn, setWarn] = useState('');
  useEffect(() => setWarn(''), [edit]);
  const blocked = (roomId: string, to: string, ignore?: string) => {
    const n = state.events.find((e) => e.id === to);
    const room = state.rooms.find((r) => r.id === roomId);
    if (!n || !room) return false;
    const c = state.blocks
      .filter((b) => b.roomId === roomId && b.eventId !== to && b.eventId !== ignore)
      .map((b) => state.events.find((e) => e.id === b.eventId))
      .find((e) => e && clashWith(state, n, e));
    if (!c) return false;
    setWarn(clashMessage(state, ignore ? 'switch to' : 'add', n, room.name, c));
    return true;
  };
  const replaceEvent = (roomId: string, from: string, to: string) => {
    setWarn('');
    if (to !== '' && blocked(roomId, to, from)) return;
    update((d) => {
    if (to === '') { d.blocks = d.blocks.filter((b) => !(b.roomId === roomId && b.eventId === from)); return; }
    const i = d.blocks.findIndex((b) => b.roomId === roomId && b.eventId === from);
    if (i < 0) return;
    if (d.blocks.some((b) => b.roomId === roomId && b.eventId === to)) d.blocks.splice(i, 1);
    else d.blocks[i].eventId = to;
    });
  };
  const addEvent = (roomId: string, eventId: string) => {
    setWarn('');
    if (blocked(roomId, eventId)) return;
    update((d) => {
      if (!d.blocks.some((b) => b.roomId === roomId && b.eventId === eventId)) d.blocks.push({ id: uid('b'), roomId, eventId });
    });
  };
  const showLabel = show === 'focus' ? hl?.label ?? '' : 'all events';
  const [busy, setBusy] = useState(false);
  const makePdf = async () => {
      let doc: jsPDF | null = null;
      for (const svg of Array.from(document.querySelectorAll<SVGSVGElement>('.floor-plans .maps figure svg'))) {
        const vb = svg.viewBox.baseVal;
        const w = vb?.width || svg.clientWidth, h = vb?.height || svg.clientHeight;
        const top = 24;
        const fmt: [number, number] = [w, h + top];
        if (!doc) doc = new jsPDF({ unit: 'pt', format: fmt, orientation: w > h + top ? 'landscape' : 'portrait' });
        else doc.addPage(fmt, w > h + top ? 'landscape' : 'portrait');
        doc.setFontSize(12);
        doc.text(`${svg.closest('figure')?.querySelector('figcaption')?.textContent ?? ''} · ${fmtTime(time)} · ${showLabel}`, 8, 16);
        await doc.svg(svg, { x: 0, y: top, width: w, height: h });
      }
      return { doc, name: `floor-plans-${fmtTime(time).replace(/[^0-9APM]/g, '')}.pdf` };
  };
  const downloadPdf = async () => {
    setBusy(true);
    try {
      const { doc, name } = await makePdf();
      doc?.save(name);
    } finally { setBusy(false); }
  };


  return (
    <div className="page floor-plans">
      <h2 className="print-only">Floor plans · {fmtTime(time)} · {showLabel} · colored by {colorBy === 'event' ? 'event' : 'tag'}</h2>
      <div className="toolbar no-print">
        <button onClick={() => setUploading(true)} disabled={uploading}>Upload floor plan</button>
        <b>Time:</b> <TimePicker time={time} setTime={setTime} />
        <label>Color by <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}><option value="event">event</option><option value="category">tag</option></select></label>
        {colorBy === 'event' && groups.length > 0 && <span className="tags-cell" title="Every room with an event in one of these groups gets that group's color">Same color for{' '}
          {gcs.map((g) => <span key={g.group} className="chip tag-chip">{g.group}
            <button className="chip-x" title={`Remove ${g.group}`} onClick={() => removeGroup(g.group)}>×</button></span>)}
          {groups.some((g) => !gcs.some((x) => x.group === g)) && (
            <select className="tag-add" title="Add event group" value="" onChange={(e) => e.target.value && addGroup(e.target.value)}>
              <option value="" hidden>+</option>
              {groups.filter((g) => !gcs.some((x) => x.group === g)).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}</span>}
        {hl && <label>Show <select value={show} onChange={(e) => setShow(e.target.value as 'app' | 'focus')}>
          <option value="app">all events</option><option value="focus">{hl.label}</option></select></label>}
        <button onClick={() => window.print()}>Print</button>
        <button onClick={downloadPdf} disabled={busy}>{busy ? 'Making PDF…' : 'Download PDF'}</button>
      </div>
      <div className={indivLegend ? 'legend legend-rows' : 'legend'}>
        {indivLegend && <>
          <div className="legend-row">
            <span className="legend-item"><b>{hl?.title}</b></span>
            <input className="proj-input" inputMode="numeric" placeholder={`Projected total: ${hl?.projectedDefault ?? ''}`}
              title="Percentages are each event's count divided by this projected total"
              value={state.projectedIndiv ?? ''}
              onChange={(x) => { const v = x.target.value.replace(/\D/g, ''); update((d) => { if (v) d.projectedIndiv = +v; else delete d.projectedIndiv; }); }} />
            <span className="legend-item" title="Sum of the percentages in this row">Percentages add to {indivPct}%</span>
          </div>
          <div className="legend-row">
            {indivRows.map(({ e, total }) => (
              <span key={e.id} className="legend-item">
                <label className="legend-color" title="Click to change color"><Swatch color={e.color} /><span>{e.name} <b>{total}</b> · {pct(total)}%</span>
                  <input type="color" value={e.color.toLowerCase()} onChange={(x) => setColor(e.id, x.target.value)} /></label>
              </span>
            ))}
          </div>
        </>}
        <div className={indivLegend ? 'legend-row' : 'legend-contents'}>
          {[...legend.values()].filter((e) => !indivIds.has(e.key)).sort((a, b) => a.label.localeCompare(b.label)).map((e) => (
            <span key={e.key} className="legend-item">
              {e.key === 'none' ? <><Swatch color={e.color} />{e.label}</> : (
                <label className="legend-color" title="Click to change color"><Swatch color={e.color} />{e.label}
                  <input type="color" value={e.color.toLowerCase()} onChange={(x) => setColor(e.key, x.target.value)} /></label>
              )}
            </span>
          ))}
          {([...(only ? [['other', 'In use']] as const : []), [only ? 'focusUnused' : 'unused', 'Nothing scheduled'], ['unknown', 'Not in rooms list']] as const).map(([k, label]) => (
            <span key={k} className="legend-item">
              <label className="legend-color" title="Click to change color"><Swatch color={state.mapColors[k]} />{label}
                <input type="color" value={state.mapColors[k]} onChange={(x) => update((d) => { d.mapColors[k] = x.target.value; })} /></label>
            </span>
          ))}
        </div>
      </div>
      {uploading && <MapUpload state={state} update={update} onClose={() => setUploading(false)} />}
      {!uploading && !state.config.maps.length && <p className="muted">No floor plans yet. Open a data package from More ▾, or click “Upload floor plan” to add an SVG.</p>}
      <div className="maps" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick}>
        {rendered.map(({ b, svg }) => (
          <figure key={b} className="map"><figcaption>{b} <span className="no-print map-del" onClick={(e) => e.stopPropagation()}>
            <ConfirmButton label="Delete floor plan" onConfirm={() => update((d) => { d.config.maps = d.config.maps.filter((m) => m.name !== b); })} /></span></figcaption>
            {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <p>Loading…</p>}
          </figure>
        ))}
        <figure className="map"><figcaption>Not on the floor plans (standalone)</figcaption>
          <svg viewBox={`0 0 ${standalone.length * 220 + 20} 180`} className="standalone">
            {sEntries.map(({ r, e }, i) => {
              const fill = e?.color ?? (only && roomEntry(state, r.id, time, colorBy, variant) ? state.mapColors.other : only ? state.mapColors.focusUnused : state.mapColors.unused);
              return (
                <g key={r.id} data-room={r.id}>
                  <rect x={20 + i * 220} y={20} width={200} height={140} fill={fill} stroke="#333" strokeWidth={2} />
                  <text x={120 + i * 220} y={85} textAnchor="middle" fontSize={24} fontWeight={600} fill={textColor(fill)}>{r.name}</text>
                  <text x={120 + i * 220} y={115} textAnchor="middle" fontSize={16} fill={textColor(fill)}>{e?.label ?? ''}</text>
                </g>
              );
            })}
          </svg>
        </figure>
      </div>
      {!edit && hover && hRoom && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <b>{hRoom.name}</b> ({hRoom.type}, [Raw] {hRoom.base ?? '—'})<br />
          {roomEventsAt(state, hRoom.id, time).map((e) => (
            <div key={e.id}><Swatch color={e.color} />{e.name} {fmtTime(e.start)}–{fmtTime(e.end)} · cap {roomCapacity(state, hRoom, e.capacityType).value ?? '—'}</div>
          ))}
          {roomEventsAt(state, hRoom.id, time).length === 0 && <i>Nothing scheduled</i>}
        </div>
      )}
      {!edit && hover && !hRoom && <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}><b>{state.rooms.find((r) => r.id === hover.id)?.name ?? hover.id}</b><br />Do not have this room</div>}
      {edit && (
        <div ref={editRef} className="room-edit no-print" style={{ left: edit.x, top: edit.y }}>
          {!eRoom ? <><b>{edit.id}</b><div className="muted">Not in the rooms list (or its status isn't Yes), so it can't be edited.</div></> : <>
            <b>{eRoom.name}</b> <span className="muted">at {fmtTime(time)}</span>
            {eEvents.map((e) => (
              <div key={e.id} className="room-edit-row">
                <Swatch color={e.color} />
                <select value={e.id} onChange={(x) => replaceEvent(eRoom.id, e.id, x.target.value)}>
                  {!choices.some((c) => c.id === e.id) && <option value={e.id}>{optLabel(e)}</option>}
                  {choices.map((c) => <option key={c.id} value={c.id}>{optLabel(c)}</option>)}
                  <option value="">Nothing</option>
                </select>
              </div>
            ))}
            {eEvents.length === 0 && <div className="room-edit-row">
              <select value="" onChange={(x) => x.target.value && addEvent(eRoom.id, x.target.value)}>
                <option value="">Nothing scheduled. Add event…</option>
                {choices.filter((c) => !eEvents.some((e) => e.id === c.id)).map((c) => <option key={c.id} value={c.id}>{optLabel(c)}</option>)}
              </select>
            </div>}
            {warn && <div className="room-edit-warn" role="alert">{warn}</div>}
            <div className="muted small">Lists events running at {fmtTime(time)}.</div>
          </>}
        </div>
      )}
    </div>
  );
}
