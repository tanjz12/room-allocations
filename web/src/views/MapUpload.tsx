import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapDef } from '../lib/config';
import { sanitizeSvg } from '../lib/maps';
import type { ViewProps } from './common';
import ColorPicker from './ColorPicker';
import { usedColors } from '../lib/colors';

type Cand = { i: number; box: [number, number, number, number]; orig: string; room: string };
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
    if (!c?.room) return;
    el.setAttribute('data-room', c.room);
    (rooms[c.room] ??= []).push({ orig: c.orig, box: c.box.map((v) => Math.round(v * 100) / 100), added: labels && !rooms[c.room]?.length });
    names[c.room] = roomName(c.room);
  });
  const step = Math.min(h / 12, legendW * 0.22);
  return {
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

  const setRoom = (room: string) => {
    if (!parsed || sel === null) return;
    setParsed({ ...parsed, cands: parsed.cands.map((c) => (c.i === sel ? { ...c, room } : c)) });
  };
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
            </> : <p className="muted small">Select a shape on the plan.</p>}
            <h3>Matched</h3>
            {!assigned.length && <p className="muted small">None yet.</p>}
            <ul className="matched">
              {assigned.map((c) => <li key={c.i}><button className="link" onClick={() => setSel(c.i)}>{roomName(c.room)}</button></li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
