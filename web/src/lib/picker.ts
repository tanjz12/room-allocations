/** Google Picker: the only way the site gets at existing Drive files and folders under the `drive.file` permission. */
const APP_ID = '430282329215';
/** Browser API key of the Google Cloud project "bmt-room-allocation", limited to the site's addresses and the Picker API; API keys in web pages are public. */
export const PICKER_KEY = 'AIzaSyDYlpr61r9JoKXSdgaIiUXlhyP9z6Vh8_Y';

type PickerDoc = { id: string; name: string; parentId?: string; mimeType?: string };
type PickerData = { action: string; docs?: PickerDoc[] };
/* eslint-disable @typescript-eslint/no-explicit-any */
const win = () => window as any;
let load: Promise<void> | null = null;
const loadPicker = () => (load ??= new Promise<void>((ok, fail) => {
  const done = () => win().gapi.load('picker', { callback: () => ok(), onerror: () => { load = null; fail(new Error('could not load the Google file picker')); } });
  if (win().gapi) return done();
  const s = document.createElement('script');
  s.src = 'https://apis.google.com/js/api.js'; s.async = true;
  s.onload = done; s.onerror = () => { load = null; fail(new Error('could not load the Google file picker (blocked by an ad blocker?)')); };
  document.head.appendChild(s);
}));

export type Picked = { id: string; name: string; parentId: string };
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Opens the picker for a data package file (`file`) or a folder; `start` is the folder it opens in. Resolves null on cancel. */
export async function pickDrive(token: string, kind: 'file' | 'folder', title: string, start?: string, mimes?: string): Promise<Picked | null> {
  if (!PICKER_KEY) throw new Error('the Google file picker is not set up for this site');
  await loadPicker();
  const P = win().google.picker;
  const view = kind === 'folder'
    ? new P.DocsView(P.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true).setMimeTypes(FOLDER_MIME)
    : new P.DocsView(P.ViewId.DOCS).setIncludeFolders(true).setMimeTypes(mimes ?? 'application/json,application/gzip,application/x-gzip,application/octet-stream');
  if (start) view.setParent(start);
  const shared = (kind === 'folder'
    ? new P.DocsView(P.ViewId.FOLDERS).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME)
    : new P.DocsView(P.ViewId.DOCS).setIncludeFolders(true)).setEnableDrives(true);
  const tip = document.createElement('div');
  tip.className = 'picker-tip';
  tip.textContent = 'If Google asks to allow cookies, click Allow cookies, then Allow in the browser\u2019s prompt. If it says it can\u2019t access your account, your browser is blocking Google\u2019s cookies here: allow third-party cookies for this site or use a normal (not private) window.';
  document.body.appendChild(tip);
  return new Promise<Picked | null>((ok) => {
    new P.PickerBuilder()
      .setOAuthToken(token).setDeveloperKey(PICKER_KEY).setAppId(APP_ID).setTitle(title)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .addView(view).addView(shared)
      .setCallback((d: PickerData) => {
        if (d.action === P.Action.LOADED) return;
        tip.remove();
        ok(d.action === P.Action.PICKED && d.docs?.[0] ? { id: d.docs[0].id, name: d.docs[0].name, parentId: d.docs[0].parentId ?? '' } : null);
      })
      .build().setVisible(true);
  });
}

/** Picker for one HTML file (e.g. the Guts seating simulator page); picking it grants the site read/write on that file. */
export async function pickHtml(token: string, title: string): Promise<PickerDoc | null> {
  if (!PICKER_KEY) throw new Error('the Google file picker is not set up for this site');
  await loadPicker();
  const P = win().google.picker;
  const view = new P.DocsView(P.ViewId.DOCS).setIncludeFolders(true).setMimeTypes('text/html');
  const shared = new P.DocsView(P.ViewId.DOCS).setIncludeFolders(true).setMimeTypes('text/html').setEnableDrives(true);
  return new Promise<PickerDoc | null>((ok) => {
    new P.PickerBuilder()
      .setOAuthToken(token).setDeveloperKey(PICKER_KEY).setAppId(APP_ID).setTitle(title)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .addView(view).addView(shared)
      .setCallback((d: PickerData) => {
        if (d.action === P.Action.LOADED) return;
        ok(d.action === P.Action.PICKED && d.docs?.[0] ? d.docs[0] : null);
      })
      .build().setVisible(true);
  });
}
