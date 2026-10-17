import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { normalizeColor, suggestColors } from '../lib/colors';

const W = 180;

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
    setPos({ left: Math.min(Math.max(8, r.left), window.innerWidth - (pop.current?.offsetWidth ?? W) - 8), top: below ? r.bottom + 4 : Math.max(8, r.top - h - 4) });
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
    setText(value); setSugg(suggestColors([...existing, value], 4)); place(); setOpen(true);
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
          <input className="color-code" size={7} value={text} placeholder="#4a7fc1" aria-label="Color code" spellCheck={false} autoCapitalize="off" autoComplete="off"
            onChange={(e) => { setText(e.target.value); const c = normalizeColor(e.target.value); if (c) onChange(c); }} />
          <label className="color-more" title="Full color picker">More
            <input type="color" aria-label="More colors" value={normalizeColor(value) ?? '#000000'} onChange={(e) => pick(e.target.value)} /></label>
        </div>
        <div className="color-grid">
          {sugg.map((c) => { const on = c === value.toLowerCase(); return <button type="button" key={c} className={on ? 'color-cell on' : 'color-cell'} style={{ background: c }} title={c} aria-label={c} aria-pressed={on} onClick={() => pick(c)}>{on && '✓'}</button>; })}
          <button type="button" className="color-cell color-shuffle" title="Other colors" aria-label="Other colors" onClick={() => setSugg(suggestColors([...existing, value], 4))}>↻</button>
        </div>
      </div>
    </>, document.body)}
  </>;
}
