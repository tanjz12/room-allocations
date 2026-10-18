import { phaseTimes, DAY_END, DAY_START, SLOT, fmtTime, RAW_NAME, roomActive, roomCapacity, summaryValue, textColor, type Room, type State, inSched } from './model';
import { toSheetFormula } from './formula';
import { PACKAGE_FORMAT, makePackage, packageText, readPackage } from './package';
import { emptyConfig, type DriveConfig, type DriveFolder, type TypstDriveFile } from './config';
import { FOLDER_MIME, pickDrive } from './picker';

/** OAuth client of the Google Cloud project "bmt-room-allocation"; client IDs are public. */
export const CLIENT_ID = '430282329215-q7ujp9tohf79iddqs6em8vctf6t3u25l.apps.googleusercontent.com';
/** Only files the user picks in Google's picker, or that this site created. */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';
const SHEETS = 'https://sheets.googleapis.com';
const ALL = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

export type SyncMeta = { savedAt: string; dirty: boolean };
const META_KEY = 'room-alloc-sync';
export const readMeta = (): SyncMeta => {
  try { return { savedAt: '', dirty: false, ...JSON.parse(localStorage.getItem(META_KEY) ?? '{}') }; } catch { return { savedAt: '', dirty: false }; }
};
export const writeMeta = (m: SyncMeta) => localStorage.setItem(META_KEY, JSON.stringify(m));
export const fmtSaved = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const TOKEN_KEY = 'room-alloc-google';
const STATE_KEY = 'room-alloc-oauth-state';
let token: { t: string; exp: number; email: string } | null = (() => {
  try { const x = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null'); return x && x.exp > Date.now() ? x : null; } catch { return null; }
})();
const redirectUri = () => location.origin + location.pathname;

/** Result of coming back from Google's sign-in page (read once, then removed from the address bar). */
let returned: { error?: string; pending?: Promise<string> } | null = (() => {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has('access_token') && !p.has('error')) return null;
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  history.replaceState(null, '', location.pathname + location.search);
  if (!expected || p.get('state') !== expected) return { error: 'Google sign-in could not be verified. Try again' };
  if (p.has('error')) return { error: p.get('error') === 'access_denied' ? 'Google sign-in was cancelled' : `Google sign-in failed (${p.get('error')})` };
  if (!p.get('scope')?.split(' ').includes(SCOPE)) return { error: 'Google Drive access was not allowed. Sign in again and tick the Drive box' };
  token = { t: p.get('access_token')!, exp: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000, email: '' };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  const pending = api('GET', '/drive/v3/about?fields=user(emailAddress)')
    .then((r) => { if (token) { token.email = r.user.emailAddress; localStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } return driveAccount(); })
    .catch(() => driveAccount());
  return { pending };
})();
/** After a return from Google's sign-in page: resolves to the signed-in email, or rejects with the sign-in error. */
export function finishSignIn(): Promise<string> | null {
  const r = returned; returned = null;
  if (!r) return null;
  return r.error ? Promise.reject(new Error(r.error)) : r.pending!;
}

export const driveAccount = () => token?.email ?? '';
/** Sends the whole tab to Google's sign-in page; the site reloads signed in (see finishSignIn). */
export function signInDrive(): Promise<never> {
  if (!CLIENT_ID) return Promise.reject(new Error('Google sign-in is not set up for this site'));
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE,
    state, prompt: 'select_account',
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  return new Promise<never>(() => {});
}
export function signOutDrive() {
  if (token) void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.t)}`, { method: 'POST', mode: 'no-cors' }).catch(() => {});
  token = null; localStorage.removeItem(TOKEN_KEY);
}

/** A valid token, or off to Google's sign-in page (the page reloads afterwards; local edits are kept in the browser). */
function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return Promise.resolve(token.t);
  return signInDrive();
}

async function api(method: string, path: string, body?: BodyInit, type = 'application/json') {
  const r = await fetch(path.startsWith('https://') ? path : API + path, { method, body, headers: { Authorization: `Bearer ${token?.t}`, ...(body ? { 'Content-Type': type } : {}) } });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error?.message ?? text; } catch { /* keep text */ }
    if (r.status === 401) { token = null; localStorage.removeItem(TOKEN_KEY); }
    if (r.status === 403 || r.status === 404) throw new Error(`${driveAccount() || 'this Google account'} can't ${method === 'GET' ? 'open' : 'edit'} the Drive folder or file (${msg})`);
    throw new Error(`Google answered ${r.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : {};
}

const driveCfg = (s: State): DriveConfig => {
  const d = s.config.drive;
  if (!d?.folderId) throw new Error('open a data package first (More ▾ → Open from Drive… or Open data package…), so the app knows which Drive file to use');
  return d;
};
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function findFile(folderId: string, name: string, mime?: string) {
  const query = `'${q(folderId)}' in parents and name = '${q(name)}' and trashed = false${mime ? ` and mimeType = '${mime}'` : ''}`;
  const r = await api('GET', `/drive/v3/files?${ALL}&fields=files(id,appProperties)&q=${encodeURIComponent(query)}`);
  return r.files?.[0] as { id: string; appProperties?: Record<string, string> } | undefined;
}
type DriveRef = { id: string; appProperties?: Record<string, string> };
async function findJson(d: DriveConfig): Promise<DriveRef | undefined> {
  if (d.fileId) {
    const f = await api('GET', `/drive/v3/files/${d.fileId}?supportsAllDrives=true&fields=id,trashed,appProperties`).catch(() => null);
    if (f && !f.trashed) return f;
  }
  return findFile(d.folderId, d.jsonName);
}
type Doc = { savedAt?: string; state?: State };
const readDoc = async (id: string): Promise<Doc> => api('GET', `/drive/v3/files/${id}?alt=media&supportsAllDrives=true`);

/** The Drive folder comes from the data package that is open, or from `fallback` when nothing is open yet. */
export async function loadDrive(s: State, fallback?: DriveConfig) {
  const d = s.config.drive?.folderId ? s.config.drive : fallback;
  if (!d) throw new Error('open a data package first (More ▾ → Open from Drive… or Open data package…), so the app knows which Drive file to use');
  await accessToken();
  const f = await findJson(d);
  if (!f) return null;
  const doc = await readDoc(f.id);
  if (!doc.state || !doc.savedAt) return null;
  return { state: doc.state, savedAt: doc.savedAt };
}

export async function saveDrive(s: State, base: string, force: boolean): Promise<{ savedAt: string; sheetUrl: string; sheetId?: string; sheetErr?: string } | { conflict: string }> {
  const d = driveCfg(s);
  await accessToken();
  const f = await findJson(d);
  if (f && !force) {
    const cur = f.appProperties?.savedAt ?? (await readDoc(f.id)).savedAt ?? '';
    if (cur && cur !== base) return { conflict: cur };
  }
  let sheetId: string | undefined, sheetErr: string | undefined;
  try { sheetId = await sheetFor(d, !!f?.appProperties?.savedAt); } catch (e) { sheetErr = e instanceof Error ? e.message : String(e); }
  const dd: DriveConfig = { ...d, ...(sheetId ? { sheetId } : {}) };
  const ss: State = { ...s, config: { ...s.config, drive: dd } };
  const savedAt = new Date().toISOString();
  const meta = { name: d.jsonName, mimeType: 'application/json', appProperties: { savedAt, format: PACKAGE_FORMAT }, ...(f ? {} : { parents: [d.folderId] }) };
  const boundary = `b${Math.random().toString(36).slice(2)}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ ...makePackage(ss), savedAt })}\r\n--${boundary}--`;
  await api(f ? 'PATCH' : 'POST', `/upload/drive/v3/files${f ? `/${f.id}` : ''}?uploadType=multipart&supportsAllDrives=true`, body, `multipart/related; boundary=${boundary}`);
  if (!sheetId) return { savedAt, sheetUrl: '', sheetErr };
  try {
    return { savedAt, sheetId, sheetUrl: await writeSheet(ss, dd, savedAt, sheetId) };
  } catch (e) {
    return { savedAt, sheetId, sheetUrl: '', sheetErr: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------- Readable Google Sheet copy ---------- */
/** `{ f }` is a Sheets formula, e.g. `{ f: '=SUM(G4:BW4)' }`. */
type Cell = string | number | boolean | null | undefined | { f: string };
type Fmt = { bg?: string; fg?: string; bold?: boolean };
const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};
const cellData = (v: Cell, f: Fmt = {}, extra: object = {}) => ({
  userEnteredValue: v === null || v === undefined || v === '' ? undefined
    : typeof v === 'object' ? { formulaValue: v.f } : typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) },
  userEnteredFormat: {
    ...(f.bg ? { backgroundColor: rgb(f.bg) } : {}),
    textFormat: { fontFamily: 'Arial', bold: !!f.bold, ...(f.fg ? { foregroundColor: rgb(f.fg) } : {}) },
    ...extra,
  },
});
type Tab = { name: string; rows: Cell[][]; fmt?: (r: number, c: number) => Fmt; extra?: (r: number, c: number) => object; frozenRows?: number; frozenCols?: number; merges?: [number, number, number][]; widths?: [number, number][] };

/** Sheets column letters for a 0-based column index. */
const colA1 = (c: number) => { let out = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out; return out; };

/** A room's capacity cell in the Schedule tab: overrides stay typed numbers; formula capacities become Sheets formulas on the cells above. */
function capCell(s: State, r: Room, k: number, col: string, row0: number): Cell {
  const ct = s.capTypes[k];
  const res = roomCapacity(s, r, ct.id);
  if (ct.id === 'base') return res.value ?? r.base ?? '';
  if (res.source !== 'formula' || res.value == null) return res.value ?? '';
  try {
    return { f: '=' + toSheetFormula(ct.formulas[r.type], (name) => {
      const i = s.capTypes.findIndex((c) => (name === RAW_NAME ? c.id === 'base' : c.id === name || `[${c.name}]` === name));
      if (i < 0) throw new Error(name);
      return `${col}${row0 + i + 1}`;
    }) };
  } catch { return res.value; }
}

function scheduleTab(s: State): Tab {
  const rooms = s.rooms.filter(roomActive), caps = s.capTypes;
  const t0 = 2 + caps.length, nT = (DAY_END - DAY_START) / SLOT + 1, nRows = t0 + nT + 1, sched = s.config.phaseSchedules ?? [], L = Math.max(5, sched.length + 3), nCols = L + 1 + rooms.length;
  const rows: Cell[][] = Array.from({ length: nRows }, () => Array(nCols).fill(''));
  const fmt: Fmt[][] = Array.from({ length: nRows }, () => Array.from({ length: nCols }, () => ({})));
  const owner: number[][] = Array.from({ length: nRows }, () => Array(nCols).fill(-1));
  const merges: [number, number, number][] = [];
  const rowOf = (m: number, up = false) => t0 + (up ? Math.ceil : Math.floor)((m - DAY_START) / SLOT);
  sched.forEach((x, i) => { rows[0][1 + i] = `${x.name} Schedule`; });
  ['Room name', 'Room type', ...caps.map((c) => c.name)].forEach((l, i) => { rows[i][L] = l; });
  for (let i = 0; i < t0; i++) fmt[i][L] = { bg: '#efefef' };
  const col: Record<string, number> = {};
  rooms.forEach((r, i) => {
    const c = L + 1 + i; col[r.id] = c;
    rows[0][c] = r.name; rows[1][c] = r.type;
    caps.forEach((_, k) => { rows[2 + k][c] = capCell(s, r, k, colA1(c), 2); });
    for (let k = 0; k < t0; k++) fmt[k][c] = { bg: s.config.sheetTypeFill?.[r.type] ?? '#d9ead3' };
  });
  for (let k = 0; k < nT; k++) rows[t0 + k][0] = fmtTime(DAY_START + k * SLOT).replace(/ [AP]M$/, '');
  rows[t0 + nT][0] = 'END';

  // Column F summary: label, then a SUM over the room columns the site counts for that row.
  const capRow = (id: string | undefined) => { const k = caps.findIndex((c) => c.id === id); return k < 0 ? 0 : 3 + k; };
  const sumExpr = (rs: Room[], row: number): string => {
    const cs = rs.map((r) => col[r.id]).filter((c) => c !== undefined).sort((a, b) => a - b);
    const parts: string[] = [];
    for (let k = 0; k < cs.length; k++) {
      let e = k; while (e + 1 < cs.length && cs[e + 1] === cs[e] + 1) e++;
      parts.push(e > k ? `${colA1(cs[k])}${row}:${colA1(cs[e])}${row}` : `${colA1(cs[k])}${row}`); k = e;
    }
    return row && parts.length ? `SUM(${parts.join(',')})` : '0';
  };
  const sumCols = (rs: Room[], row: number): Cell => ({ f: '=' + sumExpr(rs, row) });
  const summary: [string, Cell][] = [];
  for (const x of s.config.summary ?? []) {
    const v = summaryValue(s, x);
    if (x.kind === 'cap') summary.push([x.label, sumCols(v.rooms, capRow(x.capType))]);
    else if (x.kind === 'event') summary.push([x.label, sumCols(v.rooms, capRow(s.events.find((e) => e.id === x.eventId)?.capacityType))]);
    else {
      for (const p of s.config.proctorCaps?.pills ?? []) {
        const each = (v.phases ?? []).map((q) => sumExpr(q.rooms, capRow(p.capType)));
        summary.push([`${x.label} (${p.name})`, { f: '=' + (each.length > 1 ? `MAX(${each.join(',')})` : each[0] ?? '0') }]);
      }
    }
  }
  summary.forEach(([label, val], i) => { rows[t0 + 2 * i][L] = label; fmt[t0 + 2 * i][L] = { bg: '#efefef' }; rows[t0 + 2 * i + 1][L] = val; });

  const place = (c: number, start: number, end: number, name: string, color: string) => {
    const r1 = rowOf(Math.max(start, DAY_START)), r2 = rowOf(Math.min(end, DAY_END), true) - 1;
    if (r2 < r1) return;
    for (let r = r1; r <= r2; r++) if (owner[r][c] >= 0) { rows[owner[r][c]][c] += ` / ${name}`; return; }
    rows[r1][c] = (start - DAY_START) % SLOT || (end - DAY_START) % SLOT ? `${name} (${fmtTime(start)}–${fmtTime(end)})` : name;
    for (let r = r1; r <= r2; r++) { owner[r][c] = r1; fmt[r][c] = { bg: color, fg: textColor(color) }; }
    if (r2 > r1) merges.push([r1, c, r2 - r1 + 1]);
  };
  for (const p of s.phases) sched.forEach((x, i) => { if (!inSched(p, x.key)) return; const tm = phaseTimes(p, x.key); place(1 + i, tm.start, tm.end, p.name, p.color); });
  const ev = new Map(s.events.map((e) => [e.id, e]));
  s.blocks.filter((b) => col[b.roomId] !== undefined && ev.has(b.eventId))
    .sort((a, b) => ev.get(a.eventId)!.start - ev.get(b.eventId)!.start)
    .forEach((b) => { const e = ev.get(b.eventId)!; place(col[b.roomId], e.start, e.end, e.name, e.color); });
  const center = { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' };
  return {
    name: 'Schedule', rows, fmt: (r, c) => fmt[r][c], frozenRows: 2, frozenCols: 3, merges, widths: [[1, 120], [L, 150]],
    extra: (r, c) => (r >= t0 ? (c === L ? { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'OVERFLOW_CELL' } : center) : {}),
  };
}

function dataTabs(s: State, d: DriveConfig, savedAt: string): Tab[] {
  const rooms = new Map(s.rooms.map((r) => [r.id, r]));
  const events = new Map(s.events.map((e) => [e.id, e]));
  const ref = (r: State['events'][number]['startRef']) => { const p = r && s.phases.find((x) => x.id === r.phaseId); return p ? `${r!.edge === 'start' ? 'Start' : 'End'} of ${p.name}` : ''; };
  const t = (m: number) => fmtTime(m);
  const head = (name: string, header: string[], body: Cell[][], color?: (r: number) => [number, string] | null): Tab => ({
    name, rows: [header, ...body], frozenRows: 1,
    fmt: (r, c) => (r === 0 ? { bold: true } : (() => { const x = color?.(r - 1); return x && x[0] === c ? { bg: x[1], fg: textColor(x[1]) } : {}; })()),
  });
  const blocks = s.blocks.filter((b) => rooms.has(b.roomId) && events.has(b.eventId)).map((b) => ({ r: rooms.get(b.roomId)!, e: events.get(b.eventId)! }))
    .sort((x, y) => x.r.name.localeCompare(y.r.name) || x.e.start - y.e.start);
  return [
    head('Info', ['Field', 'Value'], [
      ['Saved at', new Date(savedAt).toLocaleString()], ['Saved by', driveAccount()], ['JSON file', `${d.jsonName} (same folder)`],
      ['Note', `Written by the ${s.config.title} app on every save. Edits made here are not read back.`]]),
    head('Rooms', ['ID', 'Name', 'Building', 'Type', 'Status', '[Raw]', 'Overrides'],
      s.rooms.map((r) => [r.id, r.name, r.building, r.type, r.status ?? '', r.base, Object.entries(r.overrides).map(([k, v]) => `${k}=${v}`).join('; ')])),
    head('Events', ['Event', 'Group', 'Start', 'End', 'Start linked to', 'End linked to', 'Capacity type', 'Color'],
      s.events.map((e) => [e.name, e.group, t(e.start), t(e.end), ref(e.startRef), ref(e.endRef), e.capacityType, e.color]), (i) => [0, s.events[i].color]),
    head('Room schedule', ['Room', 'Room ID', 'Status', 'Event', 'Start', 'End'],
      blocks.map((x) => [x.r.name, x.r.id, x.r.status ?? '', x.e.name, t(x.e.start), t(x.e.end)]), (i) => [3, blocks[i].e.color]),
    head('Phases', ['Phase', ...(s.config.phaseSchedules ?? []).flatMap((x) => [`${x.name} start`, `${x.name} end`])],
      s.phases.map((p) => [p.name, ...(s.config.phaseSchedules ?? []).flatMap((x) => { if (!inSched(p, x.key)) return ['', '']; const tm = phaseTimes(p, x.key); return [t(tm.start), t(tm.end)]; })])),
    head('Categories', ['Category', 'Color', 'Internal maps', 'External maps'],
      s.categories.map((c) => [c.name, c.color, c.internal, c.external]), (i) => [1, s.categories[i].color]),
  ];
}

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
/**
 * The Sheet saved next to the package. `drive.file` only reaches Sheets this account has used with the site,
 * so a Sheet someone else made is picked once in Google's picker; Cancel makes a new one.
 * `savedBefore`: the site saved this package already, so a Sheet should exist somewhere.
 */
async function sheetFor(d: DriveConfig, savedBefore: boolean): Promise<string> {
  if (d.sheetId) {
    const f = await api('GET', `/drive/v3/files/${d.sheetId}?supportsAllDrives=true&fields=id,trashed`).catch(() => null);
    if (f && !f.trashed) return f.id;
  }
  const found = await findFile(d.folderId, d.sheetName, SHEET_MIME);
  if (found) return found.id;
  if (savedBefore) {
    const p = await pickDrive(await accessToken(), 'file', `Pick the Sheet “${d.sheetName}” so Save keeps updating it (Cancel makes a new Sheet)`, d.folderId, SHEET_MIME);
    if (p) return p.id;
  }
  return (await api('POST', '/drive/v3/files?supportsAllDrives=true&fields=id', JSON.stringify({ name: d.sheetName, mimeType: SHEET_MIME, parents: [d.folderId] }))).id;
}

async function writeSheet(s: State, d: DriveConfig, savedAt: string, id: string) {
  const tabs = [scheduleTab(s), ...dataTabs(s, d, savedAt)];
  const info = await api('GET', `${SHEETS}/v4/spreadsheets/${id}?fields=sheets.properties`);
  const existing = new Map<string, { sheetId: number }>((info.sheets ?? []).map((x: { properties: { title: string; sheetId: number } }) => [x.properties.title, x.properties]));
  const add = tabs.filter((t) => !existing.has(t.name)).map((t) => ({ addSheet: { properties: { title: t.name } } }));
  if (add.length) {
    const r = await api('POST', `${SHEETS}/v4/spreadsheets/${id}:batchUpdate`, JSON.stringify({ requests: add }));
    r.replies.forEach((x: { addSheet: { properties: { title: string; sheetId: number } } }) => existing.set(x.addSheet.properties.title, x.addSheet.properties));
  }
  const requests: object[] = [];
  tabs.forEach((t, index) => {
    const sheetId = existing.get(t.name)!.sheetId;
    const nCols = Math.max(...t.rows.map((r) => r.length), 1);
    requests.push(
      { unmergeCells: { range: { sheetId } } },
      { updateCells: { range: { sheetId }, fields: 'userEnteredValue,userEnteredFormat' } },
      { updateSheetProperties: { properties: { sheetId, index, gridProperties: { rowCount: Math.max(t.rows.length + 5, 50), columnCount: Math.max(nCols, 26), frozenRowCount: t.frozenRows ?? 0, frozenColumnCount: t.frozenCols ?? 0 } }, fields: 'index,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)' } },
      { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue,userEnteredFormat',
        rows: t.rows.map((row, r) => ({ values: Array.from({ length: nCols }, (_, c) => cellData(row[c], t.fmt?.(r, c), t.extra?.(r, c))) })) } },
      ...(t.merges ?? []).map(([r, c, n]) => ({ mergeCells: { mergeType: 'MERGE_ALL', range: { sheetId, startRowIndex: r, endRowIndex: r + n, startColumnIndex: c, endColumnIndex: c + 1 } } })),
      ...(t.widths ?? []).map(([c, px]) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
    );
  });
  const extra = [...existing.keys()].filter((n) => n === 'Sheet1' && !tabs.some((t) => t.name === n));
  for (const n of extra) requests.push({ deleteSheet: { sheetId: existing.get(n)!.sheetId } });
  await api('POST', `${SHEETS}/v4/spreadsheets/${id}:batchUpdate`, JSON.stringify({ requests }));
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

/** Opens Google's picker for a data package; Save/Load then use this exact file, and the Sheet next to it. Call straight from a click. */
export async function pickPackage(start?: string): Promise<{ state: State; savedAt: string } | null> {
  const f = await pickDrive(await accessToken(), 'file', 'Open a room allocation data package', start);
  if (!f) return null;
  const meta = await api('GET', `/drive/v3/files/${f.id}?supportsAllDrives=true&fields=parents`);
  const r = await fetch(`${API}/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token?.t}` } });
  if (!r.ok) throw new Error(`${driveAccount() || 'this Google account'} can't open ${f.name} (Google answered ${r.status})`);
  const text = await packageText(await r.blob());
  const doc = JSON.parse(text) as Doc;
  const s = readPackage(text);
  const prev = s.config?.drive;
  const sheetName = prev?.sheetName || `${f.name.replace(/\.json(\.gz)?$/i, '').replace(/[-_ ]?package$/i, '') || 'Room allocation'} Data`;
  const drive: DriveConfig = { folderId: meta.parents?.[0] ?? f.parentId, jsonName: f.name, sheetName, fileId: f.id, ...(prev?.sheetId ? { sheetId: prev.sheetId } : {}) };
  const config = { ...emptyConfig(), ...(s.config ?? {}), drive };
  return { state: { ...s, config } as State, savedAt: doc.savedAt ?? '' };
}

/** Opens Google's picker for a folder, starting in `start`. Call straight from a click. */
export async function pickFolder(title: string, start?: string): Promise<DriveFolder | null> {
  const f = await pickDrive(await accessToken(), 'folder', title, start);
  return f && { id: f.id, name: f.name };
}

async function upload(folderId: string, fileName: string, mime: string, media: Blob, mediaType: string): Promise<string> {
  const f = await findFile(folderId, fileName, mime);
  const meta = f ? { name: fileName } : { name: fileName, mimeType: mime, parents: [folderId] };
  const b = `b${Math.random().toString(36).slice(2)}`;
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mediaType}\r\n\r\n`, media, `\r\n--${b}--`]);
  const r = await api(f ? 'PATCH' : 'POST', `/upload/drive/v3/files${f ? `/${f.id}` : ''}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, body, `multipart/related; boundary=${b}`);
  return r.webViewLink as string;
}
async function subfolder(parent: string, name: string): Promise<string> {
  const f = await findFile(parent, name, FOLDER_MIME);
  if (f) return f.id;
  return (await api('POST', '/drive/v3/files?supportsAllDrives=true&fields=id', JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }))).id;
}

/** Saves the room signs PDF in `folder`, replacing a file with the same name. */
export async function saveSignsPdf(folder: DriveFolder, name: string, make: () => Promise<Blob>): Promise<string> {
  await accessToken();
  return upload(folder.id, `${name}.pdf`, 'application/pdf', await make(), 'application/pdf');
}

/** A Typst file in Drive: Save updates it in place, Save as new creates another. */
export type DriveText = TypstDriveFile;
export async function saveTypst(text: string, file: DriveText | { folderId: string; name: string }): Promise<DriveText> {
  await accessToken();
  const id = 'id' in file ? file.id : undefined;
  const meta = id ? {} : { name: file.name, mimeType: 'text/plain', parents: [file.folderId] };
  const b = `b${Math.random().toString(36).slice(2)}`;
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`, text, `\r\n--${b}--`]);
  const r = await api(id ? 'PATCH' : 'POST', `/upload/drive/v3/files${id ? `/${id}` : ''}?uploadType=multipart&supportsAllDrives=true&fields=id,name`, body, `multipart/related; boundary=${b}`);
  return { id: r.id, name: r.name, folderId: file.folderId };
}
export async function readTypst(id: string): Promise<string> {
  await accessToken();
  const r = await fetch(`${API}/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token?.t}` } });
  if (!r.ok) throw new Error(`${driveAccount() || 'this Google account'} can't open that Typst file (Google answered ${r.status})`);
  return r.text();
}

/** Saves map files into subfolders of `folder` (e.g. "Internal Maps"); files with the same name are replaced. Returns the folder's link. */
export async function saveMaps(folder: DriveFolder, files: { dir: string; name: string; blob: Blob }[], progress: (n: number) => void): Promise<string> {
  await accessToken();
  const dirs = new Map<string, string>();
  for (const [i, f] of files.entries()) {
    progress(i);
    if (!dirs.has(f.dir)) dirs.set(f.dir, await subfolder(folder.id, f.dir));
    const type = f.blob.type || 'application/octet-stream';
    await upload(dirs.get(f.dir)!, f.name, type, f.blob, type);
  }
  return `https://drive.google.com/drive/folders/${folder.id}`;
}
