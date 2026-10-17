import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SignFontFile } from '../lib/config';
import { DEFAULT_FONT, fontFromFile, googleFontFile, googleFonts, nearestWeight, previewGoogleFont, weightName, type GoogleFont } from '../lib/signs';

const POPULAR = ['IBM Plex Sans', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Nunito', 'Source Sans 3', 'Work Sans', 'Raleway', 'Noto Sans', 'Oswald', 'Merriweather', 'Roboto Slab', 'Playfair Display'];
const W = 240;

type Props = {
  value?: SignFontFile;
  kind: 'text' | 'number';
  /** No value means "same as the sign font" rather than the built-in default. */
  inherits?: boolean;
  defaultLabel: string;
  onChange: (f?: SignFontFile) => void;
  onError: (msg: string) => void;
};

export default function FontControl({ value, kind, inherits, defaultLabel, onChange, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<GoogleFont[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const uploaded = !!value && !value.google;
  const cur = value?.google ?? (value || inherits ? null : { family: DEFAULT_FONT.family, weight: DEFAULT_FONT.weight[kind] });

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const h = pop.current?.offsetHeight ?? 320;
    const below = r.bottom + 4 + h <= window.innerHeight;
    setPos({ left: Math.min(Math.max(8, r.left), window.innerWidth - W - 8), top: below ? r.bottom + 4 : Math.max(8, r.top - h - 4) });
  }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const raf = requestAnimationFrame(place);
    return () => {
      document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); cancelAnimationFrame(raf);
    };
  }, [open, place]);
  useEffect(() => {
    if (!open || list) return;
    googleFonts().then(setList, () => { onError("Couldn't load the Google font list; check the connection and try again."); setOpen(false); });
  }, [open, list, onError]);

  const shown = useMemo(() => {
    if (!list) return [];
    const s = q.trim().toLowerCase();
    if (!s) return POPULAR.map((n) => list.find((f) => f.family === n)).filter((f): f is GoogleFont => !!f);
    const hits = list.filter((f) => f.family.toLowerCase().includes(s));
    return [...hits.filter((f) => f.family.toLowerCase().startsWith(s)), ...hits.filter((f) => !f.family.toLowerCase().startsWith(s))].slice(0, 50);
  }, [list, q]);
  useEffect(() => { shown.forEach(previewGoogleFont); }, [shown]);
  const curFont = cur && list?.find((f) => f.family === cur.family);

  const pick = async (f: GoogleFont, w?: number) => {
    const weight = w ?? nearestWeight(f.weights, DEFAULT_FONT.weight[kind]);
    if (!inherits && f.family === DEFAULT_FONT.family && weight === DEFAULT_FONT.weight[kind]) { onChange(undefined); return; }
    setBusy(f.family);
    try { onChange(await googleFontFile(f, weight)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };
  const upload = async (f: File) => {
    try { onChange(await fontFromFile(f)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };

  return <>
    <button type="button" title="A .ttf file. Google Slides only shows it if it's a Google Font; the PDF always does." onClick={() => file.current?.click()}>Upload font…</button>
    {uploaded && <span className="chip tag-chip">{value.name}<button className="chip-x" title="Remove the uploaded font" onClick={() => onChange(undefined)}>×</button></span>}
    <button type="button" ref={btn} className={uploaded ? 'font-pill' : 'font-pill on'} title="Pick a Google font" aria-expanded={open} onClick={() => { setQ(''); place(); setOpen(!open); }}>
      {uploaded ? 'Google font' : value?.name ?? defaultLabel} ▾
    </button>
    <input ref={file} type="file" accept=".ttf,font/ttf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
    {open && createPortal(<>
      <div className="color-backdrop" />
      <div ref={pop} className="font-pop" style={pos} role="dialog" aria-label="Google fonts">
        <input className="font-search" autoFocus value={q} placeholder="Search Google fonts" aria-label="Search Google fonts" spellCheck={false} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
        <div className="font-list">
          {!list ? <span className="muted">Loading fonts…</span>
            : shown.length === 0 ? <span className="muted">No matching font</span>
              : shown.map((f) => {
                const on = cur?.family === f.family;
                return <button type="button" key={f.id} className={on ? 'font-item on' : 'font-item'} style={{ fontFamily: `'gf-${f.id}', sans-serif` }} aria-pressed={on} disabled={!!busy} onClick={() => void pick(f)}>
                  <span>{f.family}</span>{busy === f.family ? <span className="muted">…</span> : on && <span>✓</span>}
                </button>;
              })}
        </div>
        {curFont && cur && <label className="font-weight">Weight <select value={cur.weight} disabled={!!busy} onChange={(e) => void pick(curFont, +e.target.value)}>
          {curFont.weights.map((w) => <option key={w} value={w}>{weightName(w)}</option>)}
        </select></label>}
      </div>
    </>, document.body)}
  </>;
}
