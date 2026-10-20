import { driveAccount, driveSignedIn, driveToken, finishSignIn, signInDrive } from './lib/drive';
import { FOLDER_MIME, pickMany } from './lib/picker';

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

type Saved = { id: string; name: string; files?: string[] };
async function pick() {
  const docs = await pickMany(driveToken(), 'Open "Guts seating simulator" and select both files in it');
  if (!docs) return;
  const dir = docs.find(d => d.mimeType === FOLDER_MIME), files = docs.filter(d => d.mimeType !== FOLDER_MIME);
  const id = dir?.id ?? files[0]?.parentId ?? '';
  const saved: Saved = { id, name: dir?.name ?? 'Guts seating simulator', files: files.map(f => f.id) };
  localStorage.setItem(FOLDER_KEY, JSON.stringify(saved));
  void open();
}
/** Files the site can see: everything it can list in the folder plus the files picked one by one. */
async function visible(folder: Saved): Promise<DFile[]> {
  const out = folder.id ? await list(folder.id).catch(() => [] as DFile[]) : [];
  for (const id of folder.files ?? []) {
    if (out.some(f => f.id === id)) continue;
    try { out.push(await (await drive(`/drive/v3/files/${id}?supportsAllDrives=true&fields=id,name,modifiedTime`)).json()); } catch { /* not shared any more */ }
  }
  return out;
}

async function open() {
  const folder = JSON.parse(localStorage.getItem(FOLDER_KEY) ?? 'null') as Saved | null;
  if (!folder) return gate(`Signed in as ${driveAccount()}. `, [['Open Google file picker', () => void pick()]]);
  gate(`Loading from ${folder.name}…`, []);
  try {
    let files = await visible(folder);
    const html = files.find(f => f.name.toLowerCase().endsWith('.html'));
    if (!html) return gate(`Can't see the simulator HTML yet. Open the "Guts seating simulator" folder in the picker and select both files in it.`, [['Open Google file picker', () => void pick()]]);
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
          files = await visible(folder); runs = files.find(f => f.name === RUNS);
          reply(runs ? { ok: true, json: await text(runs.id) } : { ok: false, error: `${RUNS} isn't in "${folder.name}" yet` });
        } else if (d?.type === 'page-host:save' && typeof d.json === 'string') {
          files = await visible(folder); const cur = files.find(f => f.name === RUNS);
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
    gate((err as Error).message, [['Try again', () => void open()], ['Open Google file picker', () => void pick(), true]]);
  }
}

(async () => {
  const back = finishSignIn();
  if (back) { try { await back; } catch (err) { return gate((err as Error).message, [['Sign in with Google', () => void signInDrive()]]); } }
  if (!driveSignedIn()) return gate('', [['Sign in with Google', () => void signInDrive()]]);
  void open();
})();
