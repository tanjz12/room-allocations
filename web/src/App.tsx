import { useEffect, useRef, useState } from 'react';
import { useAppState, initialState, normalize, type State } from './lib/model';
import { DEFAULT_TITLE } from './lib/config';
import Schedule from './views/Schedule';
import CapacityView from './views/CapacityView';
import EventsView from './views/EventsView';
import RoomsView from './views/RoomsView';
import MapView from './views/MapView';
import ExportView from './views/ExportView';
import { ConfirmButton } from './views/common';
import { driveAccount, finishSignIn, fmtSaved, signInDrive, loadDrive, pickPackage, readMeta, saveDrive, signOutDrive, writeMeta, type SyncMeta } from './lib/drive';
import Privacy from './views/Privacy';
import { packageFile, packageText, readPackage } from './lib/package';

const TABS = ['Schedule', 'Capacity by use', 'Floor plans', 'Events', 'Rooms', 'Maps & Room signs'] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const { state, setState, update } = useAppState();
  const [loadErr, setLoadErr] = useState('');
  const [tab, setTab] = useState<Tab>('Schedule');
  const [time, setTime] = useState(11 * 60);
  const fileRef = useRef<HTMLInputElement>(null);
  const [meta, setMetaState] = useState<SyncMeta>(readMeta);
  const [drive, setDrive] = useState<{ busy?: string; err?: string; newer?: string; conflict?: string }>({});
  const metaRef = useRef(meta);
  const setMeta = (m: SyncMeta) => { metaRef.current = m; writeMeta(m); setMetaState(m); };
  const markDirty = () => { if (!metaRef.current.dirty) setMeta({ ...metaRef.current, dirty: true }); };
  const edit: typeof update = (fn) => { update(fn); markDirty(); };

  const applyDrive = (s: State, savedAt: string) => {
    // Files saved by older versions of the app carry no package settings; keep the open package's.
    setState(normalize(s.config ? s : { ...s, config: state.config }));
    setMeta({ savedAt, dirty: false });
    setDrive({});
  };
  const [account, setAccount] = useState(driveAccount);
  const fail = (e: unknown) => setDrive({ err: `Drive: ${e instanceof Error ? e.message : e}` });
  const loadFromDrive = async () => {
    setDrive({ busy: 'Loading…' });
    try {
      const doc = await loadDrive(state);
      setAccount(driveAccount());
      if (!doc) { setDrive({ err: 'Nothing saved to Drive yet.' }); return; }
      applyDrive(doc.state, doc.savedAt);
    } catch (e) { fail(e); }
  };
  const saveToDrive = async (force = false) => {
    setDrive({ busy: 'Saving…' });
    try {
      const r = await saveDrive(state, metaRef.current.savedAt, force);
      setAccount(driveAccount());
      if ('conflict' in r) setDrive({ conflict: r.conflict });
      else {
        const sheetId = r.sheetId;
        if (sheetId && sheetId !== state.config.drive?.sheetId) setState((x) => (x.config.drive ? { ...x, config: { ...x.config, drive: { ...x.config.drive, sheetId } } } : x));
        setMeta({ savedAt: r.savedAt, dirty: false }); setDrive(r.sheetErr ? { err: `Saved the JSON, but the Sheet wasn't updated: ${r.sheetErr}` } : {}); }
    } catch (e) { fail(e); }
  };
  const clearAll = () => { setState(initialState()); setMeta({ savedAt: '', dirty: false }); setDrive({}); };
  useEffect(() => {
    finishSignIn()?.then((email) => { setAccount(email); setDrive({}); }, (e) => fail(e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const title = state.config.title || DEFAULT_TITLE;
  const titlePrefix = title.endsWith(DEFAULT_TITLE) ? title.slice(0, -DEFAULT_TITLE.length).trim() : title;
  const prefixRef = useRef<HTMLSpanElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  useEffect(() => { const el = prefixRef.current; if (el && document.activeElement !== el) el.textContent = titlePrefix; }, [titlePrefix]);
  const saveTitle = () => {
    const el = prefixRef.current;
    if (!el) return;
    const v = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    el.textContent = v;
    setEditingTitle(false);
    if (v !== titlePrefix) edit((d) => { d.config.title = v ? `${v} ${DEFAULT_TITLE}` : DEFAULT_TITLE; });
  };
  const focusTitle = () => {
    const el = prefixRef.current;
    if (!el || document.activeElement === el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  };
  useEffect(() => { document.title = title; }, [title]);

  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const f = () => setHash(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const privacy = hash.startsWith('#privacy');
  const closePrivacy = () => { history.pushState(null, '', location.pathname + location.search); setHash(''); };
  const openFromDrive = async () => {
    if (!account) {
      setDrive({ busy: 'Opening Google sign-in…' });
      try { await signInDrive(); } catch (e) { fail(e); }
      return;
    }
    setDrive({ busy: 'Choose a data package…' });
    try {
      const doc = await pickPackage(state.config.drive?.folderId);
      setAccount(driveAccount());
      if (doc) applyDrive(doc.state, doc.savedAt); else setDrive({});
    } catch (e) { fail(e); }
  };

  const exportPackage = async () => {
    const { blob, name } = await packageFile(state);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importPackage = async (f: File) => {
    try {
      setState(normalize(readPackage(await packageText(f))));
      markDirty();
    } catch (e) { setLoadErr(`Could not read that file${e instanceof Error && e.message ? `: ${e.message}` : ''}.`); }
  };

  const props = { state, update: edit, time, setTime };
  /** Save/Load only once signed in and a package was opened from Drive (so the exact file is known). */
  const linked = !!account && !!state.config.drive?.fileId;
  const openButton = (inMenu: boolean) => !account && !inMenu
    ? <>
        <button className="hdr-btn signin" disabled={!!drive.busy} title="Sign in with Google; then click Open from Drive… to pick a data package" onClick={() => { setLoadErr(''); void openFromDrive(); }}>
          <span className="long">Sign in with Google</span><span className="short">Google Drive<span className="xs-hide"> Sign in</span></span>
        </button>
        <a className="gsi-privacy" href="#privacy">Privacy</a>
      </>
    : meta.dirty
    ? <ConfirmButton label="Open from Drive…" word="load" className={inMenu ? '' : 'primary'} onConfirm={() => { setLoadErr(''); void openFromDrive(); }} />
    : <button className={inMenu ? undefined : 'primary'} disabled={!!drive.busy} title={account ? 'Pick a data package on Google Drive' : 'Sign in with Google; then click again to pick a data package on Drive'} onClick={(e) => { setLoadErr(''); e.currentTarget.closest('details')?.removeAttribute('open'); void openFromDrive(); }}>Open from Drive…</button>;
  if (privacy) return <main className="privacy-only"><Privacy onBack={closePrivacy} /></main>;
  return (
    <div className="app">
      <header>
        <h1 className="title" title="Click to type a name in front" onClick={focusTitle}>
          <span ref={prefixRef} className={`title-prefix${titlePrefix || editingTitle ? ' has' : ''}`} contentEditable suppressContentEditableWarning spellCheck={false}
            onFocus={() => setEditingTitle(true)} onBlur={saveTitle}
            onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === 'Escape') { e.currentTarget.textContent = titlePrefix; e.currentTarget.blur(); }
            }} />
          {DEFAULT_TITLE}
        </h1>
        <nav>
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
        <div className="data-actions">
          {linked && <span className="drive-status">
            {drive.busy ?? (drive.conflict ? `Someone saved at ${fmtSaved(drive.conflict)} since you loaded.`
              : drive.newer ? `Newer version on Drive (${fmtSaved(drive.newer)}).`
              : drive.err ?? (meta.dirty ? 'Unsaved changes' : meta.savedAt ? `Saved to Drive ${fmtSaved(meta.savedAt)}` : ''))}
          </span>}
          {!linked && drive.busy && <span className="drive-status">{drive.busy}</span>}
          {!linked && drive.err && <span className="drive-status">{drive.err}</span>}
          {linked && (drive.conflict ? (
            <>
              <ConfirmButton label="Load theirs" word="load" className="" onConfirm={() => void loadFromDrive()} />
              <ConfirmButton label="Overwrite theirs" word="overwrite" className="" onConfirm={() => void saveToDrive(true)} />
            </>
          ) : (
            <button className="primary" disabled={!!drive.busy} onClick={() => void saveToDrive()}>Save to Drive</button>
          ))}
          {linked && !drive.conflict && (meta.dirty
            ? <ConfirmButton label="Load from Drive" word="load" className="" onConfirm={() => void loadFromDrive()} />
            : <button disabled={!!drive.busy} onClick={() => void loadFromDrive()}>Load from Drive</button>)}
          {!linked && openButton(false)}
          {loadErr && <span className="hdr-err">{loadErr}</span>}
          <details className="more-menu">
            <summary title="Data package and Google account">More ▾</summary>
            <div className="menu">
              {linked && openButton(true)}
              <button onClick={() => { setLoadErr(''); fileRef.current?.click(); }}>Open data package…</button>
              <button onClick={() => void exportPackage()}>Export data package</button>
              <hr className="menu-sep" />
              <ConfirmButton label="Clear all data" word="clear" className="danger" onConfirm={clearAll} />
              <hr className="menu-sep" />
              {account && <button title={`Signed in to Drive as ${account}`} onClick={() => { signOutDrive(); setAccount(''); }}>Sign out of Google<small className="menu-sub">{account}</small></button>}
              <button onClick={(e) => { e.currentTarget.closest('details')?.removeAttribute('open'); location.hash = '#privacy'; }}>Privacy</button>
            </div>
          </details>
          <input ref={fileRef} type="file" accept=".json,.gz,application/json,application/gzip" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importPackage(f); }} />
        </div>
      </header>
      <main>
        {tab === 'Schedule' && <Schedule {...props} />}
        {tab === 'Capacity by use' && <CapacityView {...props} />}
        {tab === 'Floor plans' && <MapView {...props} />}
        {tab === 'Events' && <EventsView {...props} />}
        {tab === 'Rooms' && <RoomsView {...props} />}
        {tab === 'Maps & Room signs' && <ExportView {...props} />}
      </main>
      <footer className="site-foot">
        <span>Google sign-in is only used to open and save the Drive files and folders you choose.</span>
        <a href="#privacy">Privacy</a>
      </footer>
    </div>
  );
}
