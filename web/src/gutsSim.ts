import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/700.css';
import { driveAccount, driveSignedIn, driveToken, finishSignIn, signInDrive, signOutDrive } from './lib/drive';
import { pickHtml } from './lib/picker';

// Public shell: the simulator lives in one Drive file, guts-seating-simulator.html, which the visitor picks once in
// Google's picker (the site's drive.file permission only sees picked files). Saved runs are kept inside that same file.
const FILE_KEY = 'guts-sim-file', NAME = 'guts-seating-simulator.html';
const API = 'https://www.googleapis.com';
const RUNS_RE = /<script type="application\/json" id="guts-runs">([\s\S]*?)<\/script>/;
type DFile = { id: string; name: string; modifiedTime: string };
const $ = (id: string) => document.getElementById(id)!;
let onMsg: ((e: MessageEvent) => void) | null = null;

function signOut() {
  signOutDrive();
  localStorage.removeItem(FILE_KEY);
  if (onMsg) removeEventListener('message', onMsg);
  onMsg = null;
  const frame = $('sim') as HTMLIFrameElement;
  frame.onload = null; frame.style.display = 'none'; frame.style.visibility = ''; frame.srcdoc = ''; $('gate').style.display = '';
  gate(INTRO, [['Sign in with Google', () => void signInDrive()]]);
}
const OUT: [string, () => void] = ['Sign out', signOut];
const INTRO = 'Sign in with Google so saved runs are kept in Drive and\ncan be reused next time.';

/** `hold` keeps the message and button rows at their current height so nothing on the page moves while loading. */
function gate(msg: string, buttons: [string, () => void][], hold = false) {
  for (const id of ['msg', 'btns']) $(id).style.minHeight = hold ? $(id).offsetHeight + 'px' : '';
  $('msg').textContent = msg;
  $('btns').replaceChildren(...buttons.map(([label, on]) => {
    const b = document.createElement('button'); b.textContent = label; b.onclick = on; return b;
  }));
}
async function drive(path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, { ...init, headers: { Authorization: 'Bearer ' + driveToken(), ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`Google Drive answered ${r.status}${r.status === 404 ? ` (pick ${NAME} again)` : ''}`);
  return r;
}
const meta = async (id: string): Promise<DFile> => (await drive(`/drive/v3/files/${id}?supportsAllDrives=true&fields=id,name,modifiedTime`)).json();
const text = async (id: string) => (await drive(`/drive/v3/files/${id}?alt=media&supportsAllDrives=true`)).text();
/** The page without its saved-runs block, and the runs JSON text (or ''). */
const split = (html: string) => { const m = RUNS_RE.exec(html); return { page: m ? html.replace(RUNS_RE, '') : html, runs: m ? m[1] : '' }; };

async function pick() {
  const f = await pickHtml(driveToken(), `Pick ${NAME}`);
  if (!f) return;
  localStorage.setItem(FILE_KEY, JSON.stringify({ id: f.id, name: f.name }));
  void open();
}

async function open() {
  const saved = JSON.parse(localStorage.getItem(FILE_KEY) ?? 'null') as { id: string; name: string } | null;
  if (!saved) return gate(`Signed in as ${driveAccount()}. `, [['Open Google file picker', () => void pick()], OUT]);
  gate(`Loading ${saved.name}…`, [], true);
  try {
    let file = await meta(saved.id);
    const { page: src, runs } = split(await text(file.id));
    const host = { file: file.name, canSave: true, why: '', store: runs ? JSON.parse(runs) : null, drive: true };
    const inject = `<script>window.PACKAGE_HOST=${JSON.stringify(host).replace(/</g, '\\u003c')};</script>`;
    const doctype = /^\s*<!doctype[^>]*>/i.exec(src)?.[0] ?? '';
    const frame = $('sim') as HTMLIFrameElement;
    if (onMsg) removeEventListener('message', onMsg);
    onMsg = async (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      if (e.data?.type === 'page-host:signout') return signOut();
      const d = e.data, reply = (r: object) => frame.contentWindow!.postMessage({ type: d?.type === 'page-host:load' ? 'page-host:loaded' : 'page-host:saved', id: d.id, ...r }, '*');
      try {
        if (d?.type === 'page-host:load') {
          const r = split(await text(file.id)).runs;
          reply(r ? { ok: true, json: r } : { ok: false, error: `No runs have been saved to ${file.name} yet` });
        } else if (d?.type === 'page-host:save' && typeof d.json === 'string') {
          const cur = await meta(file.id);
          if (cur.modifiedTime !== file.modifiedTime && !d.force) return reply({ conflict: true });
          const fresh = split(await text(file.id)).page, block = `<script type="application/json" id="guts-runs">${d.json.replace(/</g, '\\u003c')}</script>`;
          const body = new FormData();
          body.append('metadata', new Blob(['{}'], { type: 'application/json' }));
          body.append('file', new Blob([fresh + block], { type: 'text/html' }));
          file = await (await drive(`/upload/drive/v3/files/${file.id}?uploadType=multipart&supportsAllDrives=true&fields=id,name,modifiedTime`, { method: 'PATCH', body })).json();
          reply({ ok: true });
        }
      } catch (err) { reply({ ok: false, error: (err as Error).message }); }
    };
    addEventListener('message', onMsg);
    frame.style.visibility = 'hidden'; frame.style.display = 'block';
    frame.onload = () => { frame.onload = null; frame.style.visibility = ''; $('gate').style.display = 'none'; };
    frame.srcdoc = doctype + inject + src.slice(doctype.length);
  } catch (err) {
    gate((err as Error).message, [['Try again', () => void open()], ['Open Google file picker', () => void pick()], OUT]);
  }
}

(async () => {
  const back = finishSignIn();
  if (back) { try { await back; } catch (err) { return gate((err as Error).message, [['Sign in with Google', () => void signInDrive()]]); } }
  if (!driveSignedIn()) return gate(INTRO, [['Sign in with Google', () => void signInDrive()]]);
  void open();
})();
