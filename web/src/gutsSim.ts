import { driveAccount, driveSignedIn, driveToken, finishSignIn, pickFolder, signInDrive } from './lib/drive';

// Public shell: the simulator itself (HTML + saved runs) lives in the "Guts seating simulator" Drive folder,
// which the visitor picks once in Google's picker (the site's drive.file permission only sees picked files).
const FOLDER_KEY = 'guts-sim-folder', RUNS = 'guts-seating-runs.json';
const API = 'https://www.googleapis.com', ALL = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
type DFile = { id: string; name: string; modifiedTime: string };
const $ = (id: string) => document.getElementById(id)!;

function gate(msg: string, buttons: [string, () => void, boolean?][]) {
  $('msg').textContent = msg;
  $('btns').replaceChildren(...buttons.map(([label, on, alt]) => {
    const b = document.createElement('button'); b.textContent = label; b.onclick = on; void alt; return b;
  }));
}
async function drive(path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, { ...init, headers: { Authorization: 'Bearer ' + driveToken(), ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`Google Drive answered ${r.status}${r.status === 404 ? ' (pick the folder again)' : ''}`);
  return r;
}
async function list(folder: string): Promise<DFile[]> {
  const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
  return (await (await drive(`/drive/v3/files?q=${q}&${ALL}&corpora=allDrives&fields=files(id,name,modifiedTime)`)).json()).files;
}
const text = async (id: string) => (await drive(`/drive/v3/files/${id}?alt=media&supportsAllDrives=true`)).text();

async function pick() {
  const f = await pickFolder('Pick the "Guts seating simulator" folder');
  if (!f) return;
  localStorage.setItem(FOLDER_KEY, JSON.stringify({ id: f.id, name: f.name }));
  void open();
}

async function open() {
  const folder = JSON.parse(localStorage.getItem(FOLDER_KEY) ?? 'null') as { id: string; name: string } | null;
  if (!folder) return gate(`Signed in as ${driveAccount()}. `, [['Open Google file picker', () => void pick()]]);
  gate(`Loading from ${folder.name}…`, []);
  try {
    let files = await list(folder.id);
    const html = files.find(f => f.name.toLowerCase().endsWith('.html'));
    if (!html) return gate(`No simulator HTML found in "${folder.name}". Pick the "Guts seating simulator" folder.`, [['Pick folder', () => void pick()]]);
    let runs = files.find(f => f.name === RUNS);
    const store = runs ? JSON.parse(await text(runs.id)) : null;
    const host = { file: RUNS, canSave: true, why: '', store, drive: true };
    const inject = `<script>window.PACKAGE_HOST=${JSON.stringify(host).replace(/</g, '\\u003c')};</script>`;
    const src = await text(html.id), doctype = /^\s*<!doctype[^>]*>/i.exec(src)?.[0] ?? '';
    const page = doctype + inject + src.slice(doctype.length);
    const frame = $('sim') as HTMLIFrameElement;
    addEventListener('message', async e => {
      if (e.source !== frame.contentWindow) return;
      const d = e.data, reply = (r: object) => frame.contentWindow!.postMessage({ type: d.type === 'page-host:load' ? 'page-host:loaded' : 'page-host:saved', id: d.id, ...r }, '*');
      try {
        if (d?.type === 'page-host:load') {
          files = await list(folder.id); runs = files.find(f => f.name === RUNS);
          reply(runs ? { ok: true, json: await text(runs.id) } : { ok: false, error: `${RUNS} isn't in "${folder.name}" yet` });
        } else if (d?.type === 'page-host:save' && typeof d.json === 'string') {
          files = await list(folder.id); const cur = files.find(f => f.name === RUNS);
          if (cur && runs && cur.modifiedTime !== runs.modifiedTime && !d.force) return reply({ conflict: true });
          const meta = new Blob([JSON.stringify(cur ? {} : { name: RUNS, parents: [folder.id], mimeType: 'application/json' })], { type: 'application/json' });
          const body = new FormData(); body.append('metadata', meta); body.append('file', new Blob([d.json], { type: 'application/json' }));
          const r = await drive(cur ? `/upload/drive/v3/files/${cur.id}?uploadType=multipart&supportsAllDrives=true&fields=id,name,modifiedTime` : `/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,modifiedTime`, { method: cur ? 'PATCH' : 'POST', body });
          runs = await r.json(); reply({ ok: true });
        }
      } catch (err) { reply({ ok: false, error: (err as Error).message }); }
    });
    frame.srcdoc = page; frame.style.display = 'block'; $('gate').style.display = 'none'; document.title = 'Guts Seating Simulator';
  } catch (err) {
    gate((err as Error).message, [['Try again', () => void open()], ['Pick folder again', () => void pick(), true]]);
  }
}

(async () => {
  const back = finishSignIn();
  if (back) { try { await back; } catch (err) { return gate((err as Error).message, [['Sign in with Google', () => void signInDrive()]]); } }
  if (!driveSignedIn()) return gate('', [['Sign in with Google', () => void signInDrive()]]);
  void open();
})();
