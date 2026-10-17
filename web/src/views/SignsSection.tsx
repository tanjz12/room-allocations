import { useCallback, useEffect, useRef, useState } from 'react';
import { exportName, type NoteStyle, type RoomSign, type SignConfig, type TypstConfig, type TypstDriveFile } from '../lib/config';
import { DEFAULT_BOX_GAP, DEFAULT_HEADING, DEFAULT_LOGO, DEFAULT_SIGN_COLOR, SIGN_H, SIGN_W, buildSigns, loadSignFont, defaultLabel, logoFromFile, logoSize, signEvents, signRooms, signSvg, signsPdf, type Logo, type SignFont } from '../lib/signs';
import { pickFolder, readTypst, saveSignsPdf, saveTypst } from '../lib/drive';
import { defaultTypst, typstRooms } from '../lib/typstTemplate';
import type { ViewProps } from './common';
import ColorPicker from './ColorPicker';
import FontControl from './FontControl';
import { usedColors } from '../lib/colors';

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const download = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export default function SignsSection({ state, update }: ViewProps) {
  const cfg: SignConfig = state.config.signs ?? {};
  const [sf, setSf] = useState<SignFont | null>(null);
  const [logo, setLogo] = useState<Logo | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ err?: string; pdf?: string }>({});
  const [tyOpen, setTyOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);
  const [output, setOutput] = useState<'basic' | 'typst'>('basic');
  const [ty, setTy] = useState<{ pdf?: Uint8Array; pages: string[]; errors: string[]; code: string } | null>(null);
  const [tyBusy, setTyBusy] = useState('');
  const [tyMsg, setTyMsg] = useState<{ err?: string; ok?: string }>({});
  const tyFileRef = useRef<HTMLInputElement>(null);
  const [nf, setNf] = useState<SignFont | null>(null);
  const [numOpen, setNumOpen] = useState(false);
  const [edOpen, setEdOpen] = useState(false);
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
  const defaultName = exportName(state.config.title, 'Room Signs');
  const name = cfg.fileName?.trim() || defaultName;
  const setCfg = (p: Partial<SignConfig>) => update((d) => { d.config.signs = { ...(d.config.signs ?? {}), ...p }; });
  const setRoom = (id: string, p: Partial<RoomSign>) => update((d) => { const r = d.rooms.find((x) => x.id === id)!; r.sign = { ...(r.sign ?? {}), ...p }; });
  const logoReady = !cfg.logo || !!logo;
  const inch = (pt: number) => Math.round((pt / 72) * 100) / 100;
  const setPt = (k: 'logoSize' | 'logoX' | 'logoY' | 'boxGap', v: string, min: number, max: number) => {
    if (v === '') return setCfg({ [k]: undefined });
    if (!Number.isFinite(+v)) return;
    setCfg({ [k]: Math.min(max, Math.max(min, +v * 72)) });
  };
  const numSf = cfg.numberFont || !cfg.font ? nf : sf;
  const fset = sf && numSf ? { text: sf, number: numSf } : null;
  const fonts = fset ? { text: fset.text.font, number: fset.number.font } : null;
  const typstOut = output === 'typst' && ty?.pdf ? ty.pdf : null;
  const ready = (typstOut ? true : !!fset && signs.length > 0 && logoReady) && !busy;

  const pdf = () => typstOut
    ? Promise.resolve(new Blob([typstOut as BlobPart], { type: 'application/pdf' }))
    : signsPdf(signs, cfg, fset!, logo, (i) => setBusy(`Rendering sign ${i + 1} of ${signs.length}…`));
  const downloadPdf = async () => {
    setMsg({});
    try { download(await pdf(), `${name}.pdf`); } catch (e) { setMsg({ err: errText(e) }); }
    setBusy('');
  };

  const tcfg: TypstConfig = cfg.typst ?? {};
  const setTyCfg = (p: Partial<TypstConfig>) => setCfg({ typst: { ...tcfg, ...p } });
  const logoFile = cfg.logo && logo ? `logo.${/^data:image\/svg/.test(cfg.logo) ? 'svg' : /^data:image\/jpe?g/.test(cfg.logo) ? 'jpg' : 'png'}` : null;
  const fontFiles = fset ? [
    { name: cfg.font ? `${cfg.font.name}.ttf` : 'IBMPlexSans-Regular.ttf', b64: fset.text.b64 },
    ...(fset.number !== fset.text ? [{ name: cfg.numberFont ? `${cfg.numberFont.name}.ttf` : 'IBMPlexSans-Medium.ttf', b64: fset.number.b64 }] : [])
  ] : [];
  const tyData = tyOpen && fset && logoReady ? typstRooms(signs, cfg, fset, logo) : null;
  const roomsJson = tyData ? JSON.stringify(tyData.rooms, null, 1) : '';
  const code = tcfg.code ?? (tyData && fset ? defaultTypst(cfg, fset, tyData.footer, logoFile) : '');
  const extraFonts = (tcfg.files ?? []).filter((f) => /\.(ttf|otf)$/i.test(f.name));
  const generateTypst = async () => {
    if (!tyData) return;
    setTyMsg({});
    setTyBusy('Loading Typst… (the first time downloads about 11 MB)');
    try {
      const { compileTypst } = await import('../lib/typstCompile');
      setTyBusy('Generating…');
      const files = [{ path: 'rooms.json', data: new TextEncoder().encode(roomsJson) }];
      if (logoFile) files.push({ path: logoFile, data: new Uint8Array(await (await fetch(cfg.logo!)).arrayBuffer()) });
      for (const f of tcfg.files ?? []) files.push({ path: f.name, data: bytes(f.data) });
      const fontKey = [...fontFiles, ...extraFonts.map((f) => ({ name: f.name, b64: f.data }))].map((f) => `${f.name}:${f.b64.length}`).join('|');
      const r = await compileTypst(code, files, [...fontFiles.map((f) => bytes(f.b64)), ...extraFonts.map((f) => bytes(f.data))], fontKey);
      setTy({ ...r, code });
      if (r.pdf) setOutput('typst');
    } catch (e) { setTy({ pages: [], errors: [errText(e)], code }); }
    setTyBusy('');
  };
  const rememberTy = (f: TypstDriveFile, extra: Partial<TypstConfig> = {}) =>
    setTyCfg({ ...extra, drive: f, driveFiles: [f, ...(tcfg.driveFiles ?? []).filter((x) => x.id !== f.id)] });
  const tyName = `${(tcfg.fileName?.trim() || name).replace(/\.typ$/i, '')}.typ`;
  const saveTyNew = async () => {
    setTyMsg({});
    try {
      const folder = await pickFolder('Save the Typst file to this folder', tcfg.drive?.folderId ?? cfg.driveFolder?.id ?? state.config.drive?.folderId);
      if (!folder) return;
      setTyBusy('Saving to Drive…');
      const f = await saveTypst(code, { folderId: folder.id, name: tyName });
      rememberTy(f);
      setTyMsg({ ok: `Saved “${f.name}” to “${folder.name}”` });
    } catch (e) { setTyMsg({ err: errText(e) }); }
    setTyBusy('');
  };
  const saveTy = async () => {
    if (!tcfg.drive) return saveTyNew();
    setTyMsg({});
    setTyBusy('Saving to Drive…');
    try {
      const f = await saveTypst(code, tcfg.drive);
      rememberTy({ ...tcfg.drive, name: f.name || tcfg.drive.name });
      setTyMsg({ ok: `Saved “${f.name || tcfg.drive.name}”` });
    } catch (e) { setTyMsg({ err: errText(e) }); }
    setTyBusy('');
  };
  const loadTy = async (f: TypstDriveFile) => {
    if (tcfg.code != null && tcfg.code !== code && !confirm(`Replace the code in the editor with “${f.name}”?`)) return;
    setTyMsg({});
    setTyBusy('Loading from Drive…');
    try {
      const text = await readTypst(f.id);
      rememberTy(f, { code: text });
      setTyMsg({ ok: `Loaded “${f.name}”` });
    } catch (e) { setTyMsg({ err: errText(e) }); }
    setTyBusy('');
  };
  const addTyFiles = async (list: FileList) => {
    const add = await Promise.all([...list].map(async (f) => {
      const b = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return { name: f.name, data: btoa(bin) };
    }));
    setTyCfg({ files: [...(tcfg.files ?? []).filter((x) => !add.some((a) => a.name === x.name)), ...add] });
  };
  const openBlob = (data: BlobPart, type: string) => window.open(URL.createObjectURL(new Blob([data], { type })), '_blank');
  const panelFiles: { name: string; note: string; open: () => void; remove?: () => void }[] = [
    { name: 'rooms.json', note: `${tyData?.rooms.length ?? 0} pages`, open: () => openBlob(roomsJson, 'application/json') },
    ...(logoFile ? [{ name: logoFile, note: 'logo', open: () => window.open(cfg.logo!, '_blank') }] : []),
    ...fontFiles.map((f, i) => ({ name: f.name, note: i ? 'room number font' : 'sign font', open: () => openBlob(bytes(f.b64) as BlobPart, 'font/ttf') })),
    ...(tcfg.files ?? []).map((f) => ({ name: f.name, note: 'uploaded', open: () => openBlob(bytes(f.data) as BlobPart, 'application/octet-stream'), remove: () => setTyCfg({ files: (tcfg.files ?? []).filter((x) => x.name !== f.name) }) }))
  ];
  const toDrive = async () => {
    setMsg({});
    try {
      const folder = await pickFolder('Save room signs to this folder', cfg.driveFolder?.id ?? state.config.drive?.folderId);
      if (!folder) return;
      if (folder.id !== cfg.driveFolder?.id || folder.name !== cfg.driveFolder?.name) setCfg({ driveFolder: folder });
      setBusy('Rendering signs…');
      const link = await saveSignsPdf(folder, name, async () => {
        const p = await pdf();
        setBusy('Uploading to Drive…');
        return p;
      });
      setMsg({ pdf: link });
    } catch (e) { setMsg({ err: errText(e) }); }
    setBusy('');
  };
  const fontErr = useCallback((err: string) => setMsg({ err }), []);
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
      <button className="group-toggle sign-ed-toggle" aria-expanded={edOpen} title={edOpen ? 'Collapse' : 'Expand'} onClick={() => { setEdOpen(!edOpen); if (!edOpen) setTyOpen(false); }}>{edOpen ? '▾' : '▸'} <b>Room sign editor</b></button>
      {edOpen && <div className="sign-settings">
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
          <label title="Box color for rooms without a tag; tagged rooms use their tag color from Rooms → Tags">Untagged box color <ColorPicker value={(cfg.color || DEFAULT_SIGN_COLOR)} existing={usedColors(state)} onChange={(e) => setCfg({ color: e })} /></label>
          <div className="logo-place">
            <label title="Fixed: long room numbers shrink to fit the box. Stretch: the box widens to the left so the room number keeps its size.">Room number box <select value={cfg.boxStretch ? 'stretch' : 'fixed'} onChange={(e) => setCfg({ boxStretch: e.target.value === 'stretch' || undefined })}>
              <option value="fixed">Fixed size</option><option value="stretch">Stretch to fit room number</option>
            </select></label>
            {cfg.boxStretch && <label title="The box stops widening at this distance from the building name; past that, the room number shrinks to fit">Min gap (in) <input type="number" className="numin short" step={0.05} min={0} max={4} value={inch(cfg.boxGap ?? DEFAULT_BOX_GAP)} onChange={(e) => setPt('boxGap', e.target.value, 0, 288)} /></label>}
          </div>
          <div className="wide logo-place">
            <b>Font</b>
            <FontControl value={cfg.font} kind="text" defaultLabel="IBM Plex Sans" onChange={(f) => { setCfg({ font: f }); setMsg({}); }} onError={fontErr} />
          </div>
          <div className="wide logo-place">
            <button className="group-toggle" aria-expanded={numOpen} title={numOpen ? 'Collapse' : 'Expand'} onClick={() => setNumOpen(!numOpen)}>{numOpen ? '▾' : '▸'} <b>Change room number font</b></button>
            {numOpen
              ? <FontControl value={cfg.numberFont} kind="number" inherits={!!cfg.font} defaultLabel={cfg.font ? 'Same as sign font' : 'IBM Plex Sans Medium'} onChange={(f) => { setCfg({ numberFont: f }); setMsg({}); }} onError={fontErr} />
              : <span className="muted">{cfg.numberFont?.name ?? (cfg.font ? 'same as the sign font' : 'IBM Plex Sans Medium')}</span>}
          </div>
          {cfg.logo && <div className="wide logo-place">
            <b>Logo (inches)</b>
            <label>Size <input type="number" className="numin short" step={0.05} min={0.25} max={8} value={cfg.logoSize == null ? '' : inch(cfg.logoSize)} placeholder={String(inch(DEFAULT_LOGO.size))} onChange={(e) => setPt('logoSize', e.target.value, 18, SIGN_W)} /></label>
            <label>Center from left <input type="number" className="numin short" step={0.05} min={0} max={SIGN_W / 72} value={cfg.logoX == null ? '' : inch(cfg.logoX)} placeholder={String(inch(DEFAULT_LOGO.x))} onChange={(e) => setPt('logoX', e.target.value, 0, SIGN_W)} /></label>
            <label title="Auto centers the logo between the last event and the footer, like the BmMT 2026 signs"><input type="checkbox" checked={cfg.logoY == null} onChange={(e) => setCfg({ logoY: e.target.checked ? undefined : 486 })} /> Auto height</label>
            <label title="Distance from the top of the sign to the top of the logo">Height <input type="number" className="numin short" step={0.05} min={0} max={SIGN_H / 72} disabled={cfg.logoY == null} value={cfg.logoY == null ? '' : inch(cfg.logoY)} placeholder={cfg.logoY == null ? 'auto' : ''} onChange={(e) => setPt('logoY', e.target.value, 0, SIGN_H)} /></label>
          </div>}
          <label className="wide">Footer <textarea rows={2} value={cfg.footer ?? ''} placeholder="e.g. where to find live updates or the information desk" onChange={(e) => setCfg({ footer: e.target.value })} /></label>
          <div className="wide"><button className="primary" disabled={!fset || !logoReady} title="Show signs from the basic editor; Download PDF and Save PDF to Drive then use them" onClick={() => setOutput('basic')}>Generate</button></div>
        </div>
      </div>}
      <button className="group-toggle sign-ed-toggle" aria-expanded={tyOpen} title={tyOpen ? 'Collapse' : 'Expand'} onClick={() => { setTyOpen(!tyOpen); if (!tyOpen) setEdOpen(false); }}>{tyOpen ? '▾' : '▸'} <b>Typst editor</b>{tcfg.code != null && <span className="muted"> · edited</span>}</button>
      {tyOpen && <div className="typst-ed">
        <div className="toolbar">
          <button className="primary" disabled={!tyData || !!tyBusy} title="Compile this code; Download PDF and Save PDF to Drive then use the result" onClick={() => void generateTypst()}>Generate</button>
          <label>Typst file name <input value={tcfg.fileName ?? ''} placeholder={`${name}.typ`} onChange={(e) => setTyCfg({ fileName: e.target.value || undefined })} /></label>
          <button disabled={!code || !!tyBusy} title={tcfg.drive ? `Updates “${tcfg.drive.name}” on Drive` : 'No Typst file yet: pick a Drive folder to save a new one'} onClick={() => void saveTy()}>Save to Drive</button>
          <button disabled={!code || !!tyBusy} title="Pick a Drive folder and save the code as a new .typ file" onClick={() => void saveTyNew()}>Save as new file…</button>
          <details className="ty-load">
            <summary className={(tcfg.driveFiles ?? []).length ? 'btn-like' : 'btn-like disabled'}>Load from Drive ▾</summary>
            <div>
              {(tcfg.driveFiles ?? []).length
                ? (tcfg.driveFiles ?? []).map((f) => <button key={f.id} onClick={(e) => { e.currentTarget.closest('details')?.removeAttribute('open'); void loadTy(f); }}>{f.name}{tcfg.drive?.id === f.id ? ' (current)' : ''}</button>)
                : <span className="muted">No Typst files saved from this data package yet.</span>}
            </div>
          </details>
          {tcfg.code != null && <button title="Discard your edits and show the code generated from the basic editor" onClick={() => { if (confirm('Discard your Typst edits and use the code from the basic editor?')) setTyCfg({ code: undefined }); }}>Use basic editor code</button>}
          {tyBusy && <span className="muted">{tyBusy}</span>}
          {tcfg.drive && !tyBusy && <span className="muted">Drive file: {tcfg.drive.name}</span>}
          {tyMsg.ok && <span>{tyMsg.ok}</span>}
          {tyMsg.err && <span className="warn">{tyMsg.err}</span>}
        </div>
        <div className="typst-body">
          <div className="typst-files">
            <button className="group-toggle" aria-expanded={filesOpen} onClick={() => setFilesOpen(!filesOpen)}>{filesOpen ? '▾' : '▸'} <b>Files</b> <span className="muted">· {panelFiles.length}</span></button>
            {filesOpen && <>
              <ul>
                {panelFiles.map((f) => (
                  <li key={f.name}>
                    <button className="linkish" title="Open" onClick={f.open}>{f.name}</button> <span className="muted">{f.note}</span>
                    {f.remove && <button className="x" title="Remove" onClick={f.remove}>×</button>}
                  </li>
                ))}
              </ul>
              <button onClick={() => tyFileRef.current?.click()}>Add files…</button>
              <input ref={tyFileRef} type="file" multiple hidden onChange={(e) => { const l = e.target.files; if (l?.length) void addTyFiles(l); e.target.value = ''; }} />
              <p className="muted">Use files by name, e.g. <code>json("rooms.json")</code> or <code>image("{logoFile ?? 'logo.png'}")</code>. Uploaded .ttf/.otf fonts can be used by family name.</p>
            </>}
          </div>
          <textarea className="typst-code" spellCheck={false} value={code} onChange={(e) => setTyCfg({ code: e.target.value })} />
        </div>
        {ty && ty.errors.length > 0 && <pre className="typst-err">{ty.errors.join('\n')}</pre>}
      </div>}
      <div className="toolbar">
        <label>File name <input value={cfg.fileName ?? defaultName} placeholder={defaultName} onChange={(e) => setCfg({ fileName: e.target.value })} /></label>
        <button className="primary" disabled={!ready} onClick={() => void downloadPdf()}>Download PDF</button>
        <button disabled={!ready} onClick={() => void toDrive()} title="Pick a Drive folder; saves the PDF there, replacing a file with the same name">Save PDF to Drive…</button>
        {cfg.driveFolder && <span className="muted" title="The folder picker opens here; the package remembers the last folder used">last saved to “{cfg.driveFolder.name}”</span>}
        <span className="muted">{busy || (typstOut ? `${ty?.pages.length ?? 0} pages from the Typst editor${ty?.code !== code ? ' (code changed since Generate)' : ''}` : `${signs.length} sign${signs.length === 1 ? '' : 's'} from the basic editor`)}</span>
        {msg.err && <span className="warn">{msg.err}</span>}
        {msg.pdf && <span>Saved: <a href={msg.pdf} target="_blank" rel="noreferrer">PDF</a></span>}
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
      {typstOut && ty ? (
        <div className="sign-grid">
          {ty.pages.map((p, i) => <figure key={i} className="sign-thumb typst-page" dangerouslySetInnerHTML={{ __html: p }} />)}
        </div>
      ) : fonts && (
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
