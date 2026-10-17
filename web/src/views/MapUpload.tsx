import { useEffect, useMemo, useRef, useState } from 'react';
import type { LegendExtra, MapDef } from '../lib/config';
import { clearExtraShapes, extraShapeCount, sanitizeSvg } from '../lib/maps';
import { ConfirmButton, type ViewProps } from './common';
import type { State, Updater } from '../lib/model';
import { uid } from '../lib/model';
import ColorPicker from './ColorPicker';
import { usedColors } from '../lib/colors';

/** `legend`: label for a non-room shape that keeps its color and gets a legend entry. */
type Cand = { i: number; box: [number, number, number, number]; orig: string; room: string; legend?: string };
type Parsed = { svg: string; w: number; h: number; vb: [number, number, number, number]; cands: Cand[] };

const SHAPES = 'path, rect, polygon, ellipse, circle';
const HIDDEN = 'defs, clipPath, mask, symbol, pattern, marker';
const NONE = /^(none|transparent|rgba\(0, 0, 0, 0\))$/i;

/** Room-sized filled shapes, with boxes in the SVG's own coordinates. Shapes already tagged data-room are always kept. */
function detect(svgEl: SVGSVGElement, vb: Parsed['vb']): Cand[] {
  const sr = svgEl.getBoundingClientRect();
  const k = vb[2] / sr.width;
  const total = vb[2] * vb[3], minSide = Math.min(vb[2], vb[3]) * 0.015;
  const out: Cand[] = [];
  svgEl.querySelectorAll<SVGGraphicsElement>(SHAPES).forEach((el) => {
    if (el.closest(HIDDEN)) return;
    const cs = getComputedStyle(el);
    const tagged = el.getAttribute('data-room') ?? '';
    if (!tagged && (NONE.test(cs.fill) || cs.fill.startsWith('url(') || +cs.fillOpacity === 0 || +cs.opacity === 0 || cs.display === 'none' || cs.visibility === 'hidden')) return;
    const r = el.getBoundingClientRect();
    const box: Cand['box'] = [vb[0] + (r.left - sr.left) * k, vb[1] + (r.top - sr.top) * k, r.width * k, r.height * k];
    const area = box[2] * box[3];
    if (!tagged && (area > total * 0.25 || Math.min(box[2], box[3]) < minSide)) return;
    const i = out.length;
    el.setAttribute('data-cand', String(i));
    out.push({ i, box, orig: el.getAttribute('fill') ?? cs.fill, room: tagged });
  });
  return out;
}

function parse(text: string): Omit<Parsed, 'cands'> {
  const doc = new DOMParser().parseFromString(sanitizeSvg(text), 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.nodeName.toLowerCase() !== 'svg') throw new Error('this is not a valid SVG file');
  const num = (a: string | null) => parseFloat(a ?? '') || 0;
  let vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number) as Parsed['vb'];
  if (vb.length !== 4 || vb.some(isNaN) || !vb[2] || !vb[3]) vb = [0, 0, num(root.getAttribute('width')), num(root.getAttribute('height'))];
  if (!vb[2] || !vb[3]) throw new Error('the SVG has no size (no viewBox, width or height)');
  return { svg: new XMLSerializer().serializeToString(root), w: vb[2], h: vb[3], vb };
}

/** Adds a legend strip to the right of the drawing so the legend never covers a room. */
function finish(p: Parsed, holder: SVGSVGElement, name: string, floor: string, labels: boolean, roomName: (id: string) => string): MapDef {
  const svg = holder.cloneNode(true) as SVGSVGElement;
  svg.removeAttribute('style'); svg.removeAttribute('class');
  const [x0, y0, w, h] = p.vb;
  const legendW = Math.max(w * 0.2, 260), pad = legendW * 0.08, W = w + legendW + pad;
  svg.setAttribute('viewBox', `${x0} ${y0} ${W} ${h}`);
  svg.setAttribute('width', String(W)); svg.setAttribute('height', String(h));
  const rooms: MapDef['meta']['rooms'] = {};
  const names: Record<string, string> = {};
  svg.querySelectorAll('[data-cand]').forEach((el) => {
    const c = p.cands[+el.getAttribute('data-cand')!];
    el.removeAttribute('data-cand'); el.removeAttribute('data-room');
    el.removeAttribute('class');
    const lab = c?.legend?.trim();
    if (c && !c.room && lab) el.setAttribute('data-extra', `lx-${lab.toLowerCase()}`);
    if (!c?.room) return;
    el.setAttribute('data-room', c.room);
    (rooms[c.room] ??= []).push({ orig: c.orig, box: c.box.map((v) => Math.round(v * 100) / 100), added: labels && !rooms[c.room]?.length });
    names[c.room] = roomName(c.room);
  });
  const step = Math.min(h / 12, legendW * 0.22);
  const extra: LegendExtra[] = [];
  for (const c of p.cands) {
    const label = c.legend?.trim();
    if (c.room || !label || extra.some((x) => x.label.toLowerCase() === label.toLowerCase())) continue;
    extra.push({ key: `lx-${label.toLowerCase()}`, label, color: c.orig });
  }
  return {
    ...(extra.length ? { legendExtra: extra } : {}),
    name, svg: new XMLSerializer().serializeToString(svg), floor, legendSlots: Math.max(4, Math.floor((h * 0.9) / step) - 1),
    labels: names,
    meta: { rooms, width: W, height: h, legend: { x: x0 + w + pad, y: y0 + h * 0.05, w: legendW - pad, h: step * 0.8, step } },
  };
}

export default function MapUpload({ state, update, onClose }: Pick<ViewProps, 'state' | 'update'> & { onClose: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [floor, setFloor] = useState('#ffffff');
  const [labels, setLabels] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const rooms = useMemo(() => [...state.rooms].sort((a, b) => a.name.localeCompare(b.name)), [state.rooms]);
  const roomName = (id: string) => state.rooms.find((r) => r.id === id)?.name ?? id;
  const exists = state.config.maps.some((m) => m.name === name.trim());

  const onFile = async (f: File) => {
    setErr(''); setParsed(null); setSel(null);
    try {
      const p = parse(await f.text());
      if (!name) setName(f.name.replace(/\.svg$/i, ''));
      setParsed({ ...p, cands: [] });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  // The SVG has to be on screen before shapes can be measured.
  const svgText = parsed?.svg;
  useEffect(() => {
    const el = box.current?.querySelector('svg');
    if (!svgText || !el || !parsed || parsed.cands.length) return;
    const known = new Set(state.rooms.map((r) => r.id));
    const cands = detect(el as SVGSVGElement, parsed.vb).map((c) => ({ ...c, room: known.has(c.room) ? c.room : '' }));
    if (!cands.length) setErr('No room-sized filled shapes found. Rooms drawn as lines or merged into one shape need to be split into separate filled shapes first.');
    setParsed({ ...parsed, cands });
  }, [svgText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show selection and assignments on the live SVG.
  useEffect(() => {
    box.current?.querySelectorAll<SVGElement>('[data-cand]').forEach((el) => {
      const c = parsed?.cands[+el.getAttribute('data-cand')!];
      el.setAttribute('class', `cand${c?.room ? ' done' : ''}${c?.i === sel ? ' sel' : ''}`);
    });
  }, [parsed, sel]);

  const setCand = (patch: Partial<Cand>) => {
    if (!parsed || sel === null) return;
    setParsed({ ...parsed, cands: parsed.cands.map((c) => (c.i === sel ? { ...c, ...patch } : c)) });
  };
  const setRoom = (room: string) => setCand({ room });
  const legendCands = parsed?.cands.filter((c) => !c.room && c.legend?.trim()) ?? [];
  const assigned = parsed?.cands.filter((c) => c.room) ?? [];
  const current = sel === null ? null : parsed?.cands[sel];

  const add = () => {
    const el = box.current?.querySelector('svg');
    if (!parsed || !el) return;
    const map = finish(parsed, el as SVGSVGElement, name.trim(), floor, labels, roomName);
    update((d) => { d.config.maps = [...d.config.maps.filter((m) => m.name !== map.name), map]; });
    onClose();
  };

  return (
    <div className="upload card">
      <div className="toolbar">
        <h2>Upload floor plan</h2>
        <label>SVG file <input type="file" accept=".svg,image/svg+xml" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
        <label>Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main building" /></label>
        <label title="Fill for rooms with nothing scheduled on external maps">Floor color <ColorPicker value={floor} existing={usedColors(state)} onChange={(e) => setFloor(e)} /></label>
        <label title="Turn off if the SVG already has room names drawn on it"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Draw room names</label>
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!parsed || !assigned.length || !name.trim()} onClick={add}
          title={exists ? `Replaces the floor plan named ${name.trim()}` : undefined}>{exists ? 'Replace in maps' : 'Add to maps'}</button>
      </div>
      {err && <p className="error">{err}</p>}
      {parsed && <p className="muted small">
        Found {parsed.cands.length} shapes; {assigned.length} matched to rooms. Click a shape, then choose its room.
        {exists && <> A floor plan named <b>{name.trim()}</b> already exists and will be replaced.</>}
      </p>}
      {parsed && (
        <div className="upload-body">
          <div ref={box} className="upload-svg" onClick={(e) => {
            const c = (e.target as Element).closest('[data-cand]');
            setSel(c ? +c.getAttribute('data-cand')! : null);
          }} dangerouslySetInnerHTML={{ __html: parsed.svg }} />
          <div className="upload-side">
            {current ? <>
              <label>Room for the selected shape
                <select autoFocus value={current.room} onChange={(e) => setRoom(e.target.value)}>
                  <option value="">Not a room</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{assigned.some((c) => c.room === r.id && c.i !== current.i) ? ' (already matched)' : ''}</option>)}
                </select>
              </label>
              {!current.room && <label title="The shape keeps its color; this adds it to the map legend">Legend label (keeps its color)
                <input value={current.legend ?? ''} placeholder="e.g. Stairs" list="legend-labels" onChange={(e) => setCand({ legend: e.target.value })} />
                <datalist id="legend-labels">{(state.config.legendExtras ?? []).map((x) => <option key={x.key} value={x.label} />)}</datalist></label>}
            </> : <p className="muted small">Select a shape on the plan.</p>}
            <h3>Matched</h3>
            {!assigned.length && <p className="muted small">None yet.</p>}
            <ul className="matched">
              {assigned.map((c) => <li key={c.i}><button className="link" onClick={() => setSel(c.i)}>{roomName(c.room)}</button></li>)}
            </ul>
            {legendCands.length > 0 && <><h3>In legend</h3>
              <ul className="matched">{legendCands.map((c) => <li key={c.i}><button className="link" onClick={() => setSel(c.i)}>{c.legend}</button></li>)}</ul></>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Fill colors drawn in a map's SVG, most used first. */
const svgColors = (svg: string) => {
  const n = new Map<string, number>();
  for (const m of svg.matchAll(/fill(?:="|:\s*)(#[0-9a-fA-F]{6})\b/g)) { const c = m[1].toLowerCase(); n.set(c, (n.get(c) ?? 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
};

/** Legend entries for shapes that are not rooms (they keep their drawn color), and rooms that keep their drawn color when nothing is scheduled. */
export function MapExtras({ state, update, name, pick, setPick }: { state: State; update: Updater; name: string; pick: string | null; setPick: (key: string | null) => void }) {
  const map = state.config.maps.find((m) => m.name === name);
  if (!map) return null;
  const edit = (fn: (m: MapDef) => void) => update((d) => { const m = d.config.maps.find((x) => x.name === name); if (m) fn(m); });
  const editX = (key: string, fn: (x: LegendExtra) => void) => update((d) => { const x = d.config.legendExtras?.find((y) => y.key === key); if (x) fn(x); });
  const colors = svgColors(map.svg);
  const roomIds = Object.keys(map.meta.rooms).sort();
  const roomName = (id: string) => state.rooms.find((r) => r.id === id)?.name ?? id;
  const keep = map.keepOrig ?? [];
  return (
    <div className="map-extras no-print">
      <div><b>Legend entries for other shapes</b> <span className="muted small">Shared by all floor plans: a label or color changed here changes on every map. Tick an entry to show it in this map's legend; Pick shapes to click shapes on this map that should be drawn in its color. Other shapes keep their drawn color.</span></div>
      {(state.config.legendExtras ?? []).map((x) => {
        const n = extraShapeCount(map, x.key);
        const on = n > 0 || !!map.legendKeys?.includes(x.key);
        return (
          <div key={x.key} className="same-color-row">
            <input type="checkbox" checked={on} disabled={n > 0} aria-label={`Show ${x.label || 'entry'} in this map's legend`}
              title={n > 0 ? 'Shown because shapes on this map are picked for it' : "Show in this map's legend"}
              onChange={(e) => { const v = e.target.checked; edit((m) => { m.legendKeys = v ? [...(m.legendKeys ?? []), x.key] : (m.legendKeys ?? []).filter((k) => k !== x.key); if (!m.legendKeys.length) delete m.legendKeys; }); }} />
            <ColorPicker value={x.color} title="Color (pick the shape's color)" existing={colors} onChange={(c) => editX(x.key, (y) => { y.color = c; })} />
            <input value={x.label} placeholder="Label" aria-label="Legend label" onChange={(e) => { const v = e.target.value; editX(x.key, (y) => { y.label = v; }); }} />
            <button className={pick === x.key ? 'primary' : ''} onClick={() => setPick(pick === x.key ? null : x.key)}>{pick === x.key ? 'Done' : 'Pick shapes'}</button>
            <span className="muted small">{n ? `${n} shape${n > 1 ? 's' : ''}` : ''}{pick === x.key && ' · click shapes on the map'}</span>
            <ConfirmButton onConfirm={() => { if (pick === x.key) setPick(null); update((d) => {
              d.config.legendExtras = d.config.legendExtras!.filter((y) => y.key !== x.key);
              for (const m of d.config.maps) { clearExtraShapes(m, x.key); if (m.legendKeys) { m.legendKeys = m.legendKeys.filter((k) => k !== x.key); if (!m.legendKeys.length) delete m.legendKeys; } }
            }); }} />
          </div>
        );
      })}
      <div><button onClick={() => { const key = uid('lx'); update((d) => {
        (d.config.legendExtras ??= []).push({ key, label: '', color: colors.find((c) => c !== '#ffffff') ?? '#999999' });
        const m = d.config.maps.find((y) => y.name === name); if (m) m.legendKeys = [...(m.legendKeys ?? []), key];
      }); }}>+ Add legend entry</button></div>
      <div className="map-keep"><b>Rooms that keep their drawn color when nothing is scheduled</b>{' '}
        <span className="tags-cell">
          {keep.map((id) => <span key={id} className="chip tag-chip">{roomName(id)}
            <button className="chip-x" title={`Remove ${roomName(id)}`} onClick={() => edit((m) => { m.keepOrig = keep.filter((x) => x !== id); if (!m.keepOrig.length) delete m.keepOrig; })}>×</button></span>)}
          <select className="tag-add" title="Add room" value="" onChange={(e) => { const v = e.target.value; if (v) edit((m) => { m.keepOrig = [...keep, v]; }); }}>
            <option value="" hidden>+</option>
            {roomIds.filter((id) => !keep.includes(id)).map((id) => <option key={id} value={id}>{roomName(id)}</option>)}
          </select>
        </span>
      </div>
    </div>
  );
}
