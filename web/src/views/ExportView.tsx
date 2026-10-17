import { useState } from 'react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { fmtTime } from '../lib/model';
import { renderMap, type ColorBy } from '../lib/maps';
import { TimePicker, type ViewProps } from './common';
import { pickFolder, saveMaps } from '../lib/drive';
import { useFont } from './MapView';
import SignsSection from './SignsSection';

type Out = { name: string; svg: string; width: number; height: number };

const fileBase = (b: string, kind: 'internal' | 'external') => (kind === 'internal' ? `${b} Internal Map` : `${b.toLowerCase()}_external`);

async function toPng(o: Out, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([o.svg], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = o.width * scale; c.height = o.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

async function toPdf(o: Out): Promise<Blob> {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0';
  holder.innerHTML = o.svg;
  document.body.appendChild(holder);
  try {
    const doc = new jsPDF({ unit: 'pt', format: [o.width, o.height], orientation: o.width > o.height ? 'landscape' : 'portrait' });
    await doc.svg(holder.querySelector('svg')!, { x: 0, y: 0, width: o.width, height: o.height });
    return doc.output('blob');
  } finally { holder.remove(); }
}

export default function ExportView(props: ViewProps) {
  const { state, update, time, setTime } = props;
  const [msg, setMsg] = useState<{ err?: string; link?: string; folder?: string }>({});
  const font = useFont();
  const maps = state.config.maps;
  const [colorBy, setColorBy] = useState<ColorBy>('category');
  const [kinds, setKinds] = useState({ internal: true, external: true });
  const [fmts, setFmts] = useState({ svg: true, png: true, pdf: true });
  const [busy, setBusy] = useState('');
  const ready = maps.length > 0 && font;

  const outputs: Out[] = !ready ? [] : (['internal', 'external'] as const).filter((k) => kinds[k]).flatMap((k) =>
    maps.map((m) => {
      const r = renderMap(m, state, time, colorBy, k, font);
      return { name: fileBase(m.name, k), svg: r.svg, width: r.width, height: r.height };
    }));

  const mapFiles = async () => {
    const files: { dir: string; name: string; blob: Blob }[] = [];
    for (const o of outputs) {
      const dir = o.name.includes('Internal') ? 'Internal Maps' : 'External Maps';
      setBusy(`Rendering ${o.name}…`);
      if (fmts.svg) files.push({ dir, name: `${o.name}.svg`, blob: new Blob([o.svg], { type: 'image/svg+xml' }) });
      if (fmts.png) files.push({ dir, name: `${o.name}.png`, blob: await toPng(o) });
      if (fmts.pdf) files.push({ dir, name: `${o.name}.pdf`, blob: await toPdf(o) });
    }
    return files;
  };
  const download = async () => {
    const zip = new JSZip();
    const stamp = fmtTime(time).replace(':', '').replace(' ', '');
    for (const f of await mapFiles()) zip.folder(f.dir)!.file(f.name, f.blob);
    setBusy('Zipping…');
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `maps_${stamp}.zip`; a.click();
    setBusy('');
  };

  const toDrive = async () => {
    setMsg({});
    try {
      const last = state.config.mapsFolder;
      const folder = await pickFolder('Save maps to this folder', last?.id ?? state.config.drive?.folderId);
      if (!folder) return;
      if (folder.id !== last?.id || folder.name !== last?.name) update((d) => { d.config.mapsFolder = folder; });
      const files = await mapFiles();
      const link = await saveMaps(folder, files, (i) => setBusy(`Uploading ${i + 1} of ${files.length}…`));
      setMsg({ link, folder: folder.name });
    } catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); }
    setBusy('');
  };

  return (
    <div className="page">
      <h2>Generate maps</h2>
      <div className="toolbar">
        <b>Time:</b> <TimePicker time={time} setTime={setTime} />
        <label>Color by <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}><option value="category">tag</option><option value="event">event</option></select></label>
        <label><input type="checkbox" checked={kinds.internal} onChange={(e) => setKinds({ ...kinds, internal: e.target.checked })} /> Internal</label>
        <label><input type="checkbox" checked={kinds.external} onChange={(e) => setKinds({ ...kinds, external: e.target.checked })} /> External</label>
        {(['svg', 'png', 'pdf'] as const).map((f) => (
          <label key={f}><input type="checkbox" checked={fmts[f]} onChange={(e) => setFmts({ ...fmts, [f]: e.target.checked })} /> {f.toUpperCase()}</label>
        ))}
        <button className="primary" disabled={!ready || !!busy || !outputs.length} onClick={download}>{busy || 'Download ZIP'}</button>
        <button disabled={!ready || !!busy || !outputs.length} onClick={() => void toDrive()} title="Pick a Drive folder; saves the maps into its Internal Maps / External Maps folders, replacing files with the same name">Save to Drive…</button>
        {state.config.mapsFolder && !msg.link && <span className="muted" title="The folder picker opens here; the package remembers the last folder used">last saved to “{state.config.mapsFolder.name}”</span>}
        {msg.link && <span>Saved to <a href={msg.link} target="_blank" rel="noreferrer">{msg.folder}</a></span>}
        {msg.err && <span className="warn">{msg.err}</span>}
      </div>
      <p className="muted">Internal maps show rooms whose event is untagged or has a tag marked “Internal map”; external maps only show events with an “External map” tag (other rooms blend into the floor, labels hidden). The legend is rebuilt from what's shown.</p>
      <div className="maps">
        {outputs.map((o) => (
          <figure key={o.name} className="map"><figcaption>{o.name}</figcaption><div dangerouslySetInnerHTML={{ __html: o.svg }} /></figure>
        ))}
      </div>
      <SignsSection {...props} />
    </div>
  );
}
