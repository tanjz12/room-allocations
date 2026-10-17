import { useEffect, useRef, useState } from 'react';
import type { NoteStyle, RoomSign, SignConfig } from '../lib/config';
import { DEFAULT_HEADING, DEFAULT_LOGO, DEFAULT_SIGN_COLOR, SIGN_H, SIGN_W, buildSigns, fontFromFile, loadSignFont, logoBox, defaultLabel, logoFromFile, logoSize, signEvents, signRooms, signSvg, signsPdf, signsPptx, type Logo, type SignFont } from '../lib/signs';
import { pickFolder, saveSigns } from '../lib/drive';
import type { ViewProps } from './common';

const download = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export default function SignsSection({ state, update }: ViewProps) {
  const cfg: SignConfig = state.config.signs ?? {};
  const [sf, setSf] = useState<SignFont | null>(null);
  const fontRef = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<Logo | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ err?: string; slides?: string; pdf?: string }>({});
  const [nf, setNf] = useState<SignFont | null>(null);
  const numRef = useRef<HTMLInputElement>(null);
  const [noteEd, setNoteEd] = useState<{ roomId: string; note: string; style: NoteStyle } | null>(null);
  const numName = cfg.numberFont?.name, numData = cfg.numberFont?.data, customText = !!cfg.font;
  useEffect(() => {
    let live = true;
    if (!(numName && numData) && customText) return;
    loadSignFont(numName && numData ? { name: numName, data: numData } : undefined, 'number')
      .then((f) => { if (live) setNf(f); })
      .catch(() => { if (live) setMsg({ err: "The room number font in this package can't be read; upload it again or use the default." }); });
    return () => { live = false; };
  }, [numName, numData, customText]);
  const fontName = cfg.font?.name, fontData = cfg.font?.data;
  useEffect(() => {
    let live = true;
    loadSignFont(fontName && fontData ? { name: fontName, data: fontData } : undefined)
      .then((f) => { if (live) setSf(f); })
      .catch(() => { if (live) setMsg({ err: "The sign font in this package can't be read; upload it again or use the built-in font." }); });
    return () => { live = false; };
  }, [fontName, fontData]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { let live = true; void logoSize(cfg.logo).then((l) => { if (live) setLogo(l); }); return () => { live = false; }; }, [cfg.logo]);

  const signs = buildSigns(state);
  const rooms = signRooms(state);
  const name = cfg.fileName?.trim() || 'Room Signs';
  const setCfg = (p: Partial<SignConfig>) => update((d) => { d.config.signs = { ...(d.config.signs ?? {}), ...p }; });
  const setRoom = (id: string, p: Partial<RoomSign>) => update((d) => { const r = d.rooms.find((x) => x.id === id)!; r.sign = { ...(r.sign ?? {}), ...p }; });
  const logoReady = !cfg.logo || !!logo;
  const lb = logoBox(cfg);
  const inch = (pt: number) => Math.round((pt / 72) * 100) / 100;
  const setPt = (k: 'logoSize' | 'logoX' | 'logoY', v: string, min: number, max: number) => {
    if (v === '' || !Number.isFinite(+v)) return;
    setCfg({ [k]: Math.min(max, Math.max(min, +v * 72)) });
  };
  const numSf = cfg.numberFont || !cfg.font ? nf : sf;
  const fset = sf && numSf ? { text: sf, number: numSf } : null;
  const fonts = fset ? { text: fset.text.font, number: fset.number.font } : null;
  const ready = !!fset && signs.length > 0 && logoReady && !busy;

  const pdf = () => signsPdf(signs, cfg, fset!, logo, (i) => setBusy(`Rendering sign ${i + 1} of ${signs.length}…`));
  const downloadPdf = async () => {
    setMsg({});
    try { download(await pdf(), `${name}.pdf`); } catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); }
    setBusy('');
  };
  const toDrive = async () => {
    setMsg({});
    try {
      const folder = await pickFolder('Save room signs to this folder', cfg.driveFolder?.id ?? state.config.drive?.folderId);
      if (!folder) return;
      if (folder.id !== cfg.driveFolder?.id || folder.name !== cfg.driveFolder?.name) setCfg({ driveFolder: folder });
      setBusy('Rendering signs…');
      const r = await saveSigns(folder, name, async () => {
        const p = await pdf();
        setBusy('Building Slides…');
        const pptx = await signsPptx(signs, cfg, fset!, logo);
        setBusy('Uploading to Drive…');
        return { pdf: p, pptx };
      });
      setMsg(r);
    } catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); }
    setBusy('');
  };
  const pickFont = async (f: File) => {
    try { setCfg({ font: await fontFromFile(f) }); setMsg({}); } catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); }
  };
  const pickNumFont = async (f: File) => {
    try { setCfg({ numberFont: await fontFromFile(f) }); setMsg({}); } catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); }
  };
  const openNote = (roomId: string) => {
    const r = state.rooms.find((x) => x.id === roomId);
    setNoteEd({ roomId, note: r?.sign?.note ?? '', style: { ...(r?.sign?.noteStyle ?? {}) } });
  };
  const pickLogo = async (f: File) => {
    try { setCfg({ logo: await logoFromFile(f) }); setMsg({}); } catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); }
  };

  return (
    <section className="signs">
      <h2>Generate room signs</h2>
      <p className="muted">One letter-size sign per room in use, listing its events in time order (each once, by the event's sign name; events marked “hide on signs” on Events are left off). Rooms with nothing scheduled get no sign.</p>
      <div className="sign-settings">
        <div className="sign-logo">
          {logo ? <img src={logo.src} alt="Sign logo" /> : <span className="muted">No logo</span>}
          <div>
            <button onClick={() => fileRef.current?.click()}>{cfg.logo ? 'Replace logo…' : 'Upload logo…'}</button>
            {cfg.logo && <button onClick={() => setCfg({ logo: undefined })}>Remove</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,.svg" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickLogo(f); }} />
        </div>
        <div className="sign-fields">
          <label>Heading <input value={cfg.heading ?? DEFAULT_HEADING} onChange={(e) => setCfg({ heading: e.target.value })} /></label>
          <label title="Box color for rooms without a tag; tagged rooms use their tag color from Rooms → Tags">Untagged box color <input type="color" value={(cfg.color || DEFAULT_SIGN_COLOR).toLowerCase()} onChange={(e) => setCfg({ color: e.target.value })} /></label>
          <label>File name <input value={cfg.fileName ?? ''} placeholder="Room Signs" onChange={(e) => setCfg({ fileName: e.target.value })} /></label>
          <div className="wide logo-place">
            <b>Font</b> <span>{cfg.font ? cfg.font.name : 'IBM Plex Sans (built in)'}</span>
            <button onClick={() => fontRef.current?.click()}>{cfg.font ? 'Replace font…' : 'Upload font…'}</button>
            {cfg.font && <button onClick={() => setCfg({ font: undefined })}>Use built-in</button>}
            <input ref={fontRef} type="file" accept=".ttf,font/ttf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickFont(f); }} />
            <span className="muted">.ttf file. Google Slides only shows it if it's a Google Font; the PDF always does.</span>
          </div>
          <div className="wide logo-place">
            <b>Room number font</b> <span>{cfg.numberFont ? cfg.numberFont.name : cfg.font ? 'same as the event font' : 'IBM Plex Sans Medium (built in)'}</span>
            <button onClick={() => numRef.current?.click()}>{cfg.numberFont ? 'Replace…' : 'Upload font…'}</button>
            {cfg.numberFont && <button onClick={() => setCfg({ numberFont: undefined })}>Use default</button>}
            <input ref={numRef} type="file" accept=".ttf,font/ttf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickNumFont(f); }} />
            <span className="muted">e.g. a Medium weight .ttf for the number in the box</span>
          </div>
          {cfg.logo && <div className="wide logo-place">
            <b>Logo (inches)</b>
            <label>Size <input type="number" className="numin" step={0.05} min={0.25} max={8} value={inch(lb.size)} onChange={(e) => setPt('logoSize', e.target.value, 18, SIGN_W)} /></label>
            <label>Center from left <input type="number" className="numin" step={0.05} min={0} max={SIGN_W / 72} value={inch(lb.x)} onChange={(e) => setPt('logoX', e.target.value, 0, SIGN_W)} /></label>
            <label title="Auto centers the logo between the last event and the footer, like the BmMT 2026 signs"><input type="checkbox" checked={lb.y == null} onChange={(e) => setCfg({ logoY: e.target.checked ? undefined : 486 })} /> Auto height</label>
            {lb.y != null && <label>Top from top <input type="number" className="numin" step={0.05} min={0} max={SIGN_H / 72} value={inch(lb.y)} onChange={(e) => setPt('logoY', e.target.value, 0, SIGN_H)} /></label>}
            <button disabled={cfg.logoSize == null && cfg.logoX == null && cfg.logoY == null} onClick={() => setCfg({ logoSize: undefined, logoX: undefined, logoY: undefined })}>Reset to default</button>
            <span className="muted">default: {inch(DEFAULT_LOGO.size)} in square, centered, auto height</span>
          </div>}
          <label className="wide">Footer <textarea rows={2} value={cfg.footer ?? ''} placeholder="e.g. where to find live updates or the information desk" onChange={(e) => setCfg({ footer: e.target.value })} /></label>
        </div>
      </div>
      <div className="toolbar">
        <button className="primary" disabled={!ready} onClick={() => void downloadPdf()}>Download PDF</button>
        <button disabled={!ready} onClick={() => void toDrive()} title="Pick a Drive folder; saves a Google Slides version and a PDF there, replacing files with the same name">Save Slides + PDF to Drive…</button>
        {cfg.driveFolder && <span className="muted" title="The folder picker opens here; the package remembers the last folder used">last saved to “{cfg.driveFolder.name}”</span>}
        <span className="muted">{busy || `${signs.length} sign${signs.length === 1 ? '' : 's'}`}</span>
        {msg.err && <span className="warn">{msg.err}</span>}
        {msg.slides && <span>Saved: <a href={msg.slides} target="_blank" rel="noreferrer">Slides</a> · <a href={msg.pdf} target="_blank" rel="noreferrer">PDF</a></span>}
      </div>
      <details className="sign-rooms">
        <summary>Room sign details ({rooms.length} rooms in use)</summary>
        <p className="muted">Blank fields use the room's building and name. The note adds lines under the events (one per line). Copies print “1 of 2”, “2 of 2”, … for rooms with several doors.</p>
        <table className="table">
          <thead><tr><th>Room</th><th>Sign</th><th>Building</th><th>Floor</th><th>Room label</th><th>Copies</th><th>Note</th><th>Events on sign</th></tr></thead>
          <tbody>
            {rooms.map((r) => {
              const sg = r.sign ?? {};
              const ev = signEvents(state, r);
              return (
                <tr key={r.id} className={sg.hide || !ev.length ? 'inactive' : undefined}>
                  <td><b>{r.name}</b></td>
                  <td><input type="checkbox" checked={!sg.hide} title="Make a sign for this room" onChange={(e) => setRoom(r.id, { hide: !e.target.checked })} /></td>
                  <td><input className="sign-in" value={sg.building ?? ''} placeholder={r.building} onChange={(e) => setRoom(r.id, { building: e.target.value })} /></td>
                  <td><input className="sign-in" value={sg.floor ?? ''} placeholder="—" onChange={(e) => setRoom(r.id, { floor: e.target.value })} /></td>
                  <td><input className="sign-in" value={sg.label ?? ''} placeholder={defaultLabel(r)} onChange={(e) => setRoom(r.id, { label: e.target.value })} /></td>
                  <td><input type="number" min={1} max={20} className="numin" value={sg.copies ?? 1} onChange={(e) => setRoom(r.id, { copies: Math.max(1, +e.target.value || 1) })} /></td>
                  <td><textarea className="sign-note" rows={1} value={sg.note ?? ''} onChange={(e) => setRoom(r.id, { note: e.target.value })} /></td>
                  <td className="muted">{ev.join(' · ') || 'nothing shown'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
      {fonts && (
        <div className="sign-grid">
          {signs.map((sg) => (
            <figure key={`${sg.roomId}-${sg.copy}`} className="sign-thumb" title="Click to add or edit this sign's note" onClick={() => openNote(sg.roomId)} dangerouslySetInnerHTML={{ __html: signSvg(sg, cfg, fonts, logo) }} />
          ))}
        </div>
      )}
      {noteEd && (
        <div className="sign-editor">
          <b>Note on the {state.rooms.find((r) => r.id === noteEd.roomId)?.name} sign</b>
          <span className="muted">Printed under the events. Each line prints as its own line, shrunk to fit the width if needed. Applies to every copy of this room's sign.</span>
          <textarea rows={4} autoFocus value={noteEd.note} onChange={(e) => setNoteEd({ ...noteEd, note: e.target.value })} />
          <div className="toolbar note-style">
            <label title="Blank: same size as the events, shrunk to fit">Size (pt) <input type="number" className="numin" min={6} max={110} value={noteEd.style.size ?? ''} placeholder="auto" onChange={(e) => setNoteEd({ ...noteEd, style: { ...noteEd.style, size: e.target.value === '' ? undefined : Math.max(6, Math.min(110, +e.target.value || 0)) } })} /></label>
            <label>Font <select value={noteEd.style.font ?? 'text'} onChange={(e) => setNoteEd({ ...noteEd, style: { ...noteEd.style, font: e.target.value as 'text' | 'number' } })}>
              <option value="text">Event font</option><option value="number">Room number font</option>
            </select></label>
            {([['bold', 'B', 'Bold'], ['italic', 'I', 'Italic'], ['underline', 'U', 'Underline'], ['strike', 'S', 'Strikethrough']] as const).map(([k, l, t]) => (
              <button key={k} title={t} aria-pressed={!!noteEd.style[k]} className={`fmt fmt-${k}${noteEd.style[k] ? ' on' : ''}`} onClick={() => setNoteEd({ ...noteEd, style: { ...noteEd.style, [k]: !noteEd.style[k] } })}>{l}</button>
            ))}
          </div>
          <div className="toolbar">
            <button className="primary" onClick={() => { const st = Object.fromEntries(Object.entries(noteEd.style).filter(([, v]) => v && v !== 'text')) as NoteStyle; setRoom(noteEd.roomId, { note: noteEd.note.replace(/\s+$/, ''), noteStyle: Object.keys(st).length ? st : undefined }); setNoteEd(null); }}>Save</button>
            <button onClick={() => setNoteEd(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
