import { useEffect, useState } from 'react';
import { activityText, type Activity } from '../lib/activity';
import { cachedVisits, driveSignedIn, readVisits, type Visit } from '../lib/drive';
import type { State } from '../lib/model';

const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ActivityLog({ state, onClose }: { state: State; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'edit' | 'visit'>('all');
  const url = state.config.visitLog ?? '', canRead = !!url && driveSignedIn();
  const [visits, setVisits] = useState<Visit[]>(() => (canRead ? cachedVisits(url) : []));
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => { if (canRead) readVisits(url).then((v) => { setVisits(v); setStatus('ok'); }, () => setStatus('error')); }, [url, canRead]);
  const note = !url ? "Visits aren't set up for this package yet." : !canRead ? 'Sign in with Google to see visits.' : status === 'error' ? "Couldn't read the visit log; showing the last visits this browser saw." : '';
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  type Row = Activity & { visit?: boolean };
  const all: Row[] = [...(kind === 'visit' ? [] : state.activity ?? []), ...(kind === 'edit' ? [] : visits.map((v) => ({ ...v, visit: true })))];
  const rows = all.sort((a, b) => b.at.localeCompare(a.at)).filter((e) => { const t = `${e.by} ${activityText(e)}`.toLowerCase(); return words.every((w) => t.includes(w)); });
  return (
    <div className="overlay" onClick={onClose}>
      <div className="picker activity" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <h2>Activity log</h2>
          <input type="search" placeholder="Filter (room, event, person…)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="all">Edits and visits</option><option value="edit">Edits</option><option value="visit">Visits</option></select>
          <button className="close" onClick={onClose}>Close</button>
        </div>
        <p className="hint">Newest first. Edits (site and Sheet sync) are kept in the data package when someone clicks Save to Drive. Visits, tab views and saves by people signed in with Google go to a log file next to the package.{note && kind !== 'edit' ? ` ${note}` : ''}</p>
        {canRead && status === 'loading' && kind !== 'edit' && <p className="log-loading" role="status"><span className="spinner" />{visits.length ? 'Refreshing visits…' : 'Loading visits…'}</p>}
        {rows.length ? (
          <table className="activity-table">
            <tbody>
              {rows.map((e, i) => <tr key={i} className={e.visit ? 'visit' : ''}><td className="when">{when(e.at)}</td><td className="by">{e.by}</td><td>{activityText(e)}</td></tr>)}
            </tbody>
          </table>
        ) : <p className="center">{all.length ? 'Nothing matches the filter.' : canRead && status === 'loading' ? '' : 'Nothing recorded yet.'}</p>}
      </div>
    </div>
  );
}
