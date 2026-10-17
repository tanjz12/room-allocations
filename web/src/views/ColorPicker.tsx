import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { normalizeColor, suggestColors } from '../lib/colors';

const W = 252;

/** A color button that opens suggested colors, a color-code box and the browser's full color picker (a bottom sheet on phones). */
export default function ColorPicker({ value, onChange, existing = [], title = 'Change color', className, children }: {
  value: string; onChange: (c: string) => void; existing?: string[]; title?: string; className?: string; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [sugg, setSugg] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const h = pop.current?.offsetHeight ?? 260;
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
  const toggle = () => {
    if (open) { setOpen(false); return; }
    setText(value); setSugg(suggestColors(existing)); place(); setOpen(true);
  };
  const pick = (c: string) => { onChange(c); setText(c); };
  return <>
    <button type="button" ref={btn} className={children ? `color-trigger ${className ?? ''}` : `color-btn ${className ?? ''}`} title={title} aria-label={children ? undefined : title} aria-expanded={open} onClick={toggle}>
      {children ?? <span className="color-btn-fill" style={{ background: value }} />}
    </button>
    {open && createPortal(<>
      <div className="color-backdrop" />
      <div ref={pop} className="color-pop" style={pos} role="dialog" aria-label={title}>
        <div className="color-pop-head">
          <span className="color-cur" style={{ background: value }} />
          <input value={text} placeholder="#4a7fc1" aria-label="Color code" spellCheck={false} autoCapitalize="off" autoComplete="off"
            onChange={(e) => { setText(e.target.value); const c = normalizeColor(e.target.value); if (c) onChange(c); }} />
          <button type="button" className="color-close" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="color-sugg-label">Suggested
          <button type="button" className="color-shuffle" title="Show other suggestions" onClick={() => setSugg(suggestColors(existing))}>↻ Shuffle</button>
        </div>
        <div className="color-grid">
          {sugg.map((c) => <button type="button" key={c} className={c === value.toLowerCase() ? 'color-cell on' : 'color-cell'} style={{ background: c }} title={c} aria-label={c} onClick={() => pick(c)} />)}
        </div>
        <label className="color-more">More colors… <input type="color" value={normalizeColor(value) ?? '#000000'} onChange={(e) => pick(e.target.value)} /></label>
      </div>
    </>, document.body)}
  </>;
}
