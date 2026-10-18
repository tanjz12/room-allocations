import { DAY_START, OTHER_GROUP, isSub, fmtTime, groupedEvents, forgetEvent, uid, type EventT } from '../lib/model';
import { ConfirmButton, EventTimeSelect, type ViewProps } from './common';
import PhaseSchedule from './PhaseSchedule';
import ColorPicker from './ColorPicker';
import { usedColors, defaultColor } from '../lib/colors';

export default function EventsView({ state, update }: ViewProps) {
  const sub = state.config.subgroup;
  const setEv = (id: string, patch: Record<string, unknown>) =>
    update((d) => { Object.assign(d.events.find((e) => e.id === id)!, patch); });

  const sameTimes = (es: EventT[]) => es.every((e) => e.start === es[0].start && e.end === es[0].end &&
    JSON.stringify([e.startRef, e.endRef]) === JSON.stringify([es[0].startRef, es[0].endRef]));
  const setTimes = (ids: string[], patch: (e: EventT) => Partial<EventT>) =>
    update((d) => { const p = patch(d.events.find((e) => e.id === ids[0])!); d.events.forEach((e) => { if (ids.includes(e.id)) Object.assign(e, p); }); });
  const addEvent = (group: string) => update((d) => {
    d.events.push({ id: uid('e'), name: 'New event', color: defaultColor(d), start: DAY_START + 120, end: DAY_START + 180, startRef: null, endRef: null, capacityType: 'base', group });
  });
  const timeCells = (e: EventT, ids: string[]) => <>
    <td><EventTimeSelect state={state} value={e.start} timeRef={e.startRef}
      onChange={(t, r) => setTimes(ids, (x) => t < x.end ? { start: t, startRef: r, end: x.end, endRef: x.endRef } : { start: t, startRef: r, end: t + 15, endRef: null })} /></td>
    <td><EventTimeSelect state={state} includeEnd value={e.end} timeRef={e.endRef}
      onChange={(t, r) => setTimes(ids, (x) => t > x.start ? { end: t, endRef: r, start: x.start, startRef: x.startRef } : { end: t, endRef: r, start: t - 15, startRef: null })} /></td>
  </>;
  const colorIn = (e: EventT) => <ColorPicker value={e.color} existing={usedColors(state)} onChange={(x) => setEv(e.id, { color: x })} />;
  const nameIn = (e: EventT) => <input className="name-in" value={e.name} onChange={(x) => setEv(e.id, { name: x.target.value })} />;
  const row = (e: EventT, inSub = false) => (
    <tr key={e.id} className={inSub ? 'sub-row' : undefined}>
      <td>{colorIn(e)}</td><td>{nameIn(e)}</td>
      <td><textarea className="name-in sign-name" rows={Math.max(1, (e.signName ?? '').split('\n').length)} value={e.signName ?? ''} placeholder={e.name} disabled={!!e.signHide} title="Name printed on room signs; blank uses the event name" onChange={(x) => setEv(e.id, { signName: x.target.value })} /></td>
      <td className="center"><input type="checkbox" checked={!!e.signHide} title="Leave this event off room signs" onChange={(x) => setEv(e.id, { signHide: x.target.checked })} /></td>
      <td className="center"><input type="checkbox" checked={!!e.signFirst} disabled={!!e.signHide} title="List this event first on room signs" onChange={(x) => setEv(e.id, { signFirst: x.target.checked || undefined })} /></td>
      {inSub ? <td colSpan={2} className="muted">{fmtTime(e.start)}–{fmtTime(e.end)} ({sub?.name})</td> : timeCells(e, [e.id])}
      <td><select className="cap-sel" value={e.capacityType} onChange={(x) => setEv(e.id, { capacityType: x.target.value })}>
        {state.capTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
      <td><ConfirmButton onConfirm={() => update((d) => { d.events = d.events.filter((x) => x.id !== e.id); d.blocks = d.blocks.filter((b) => b.eventId !== e.id); forgetEvent(d, e.id); })} /></td>
    </tr>
  );

  return (
    <div className="page">
      <section>
        <h2>Events</h2>
        <p className="muted">Start/end can be a fixed time or the start/end of a phase. Linked times follow the phase's times in the schedule picked under Align events.</p>
        <div className="fit-w">
        <table className="table">
          <thead><tr><th>Color</th><th>Name</th><th>Sign name</th><th title="Leave off room signs">Hide on signs</th><th title="List first on room signs">List first</th><th>Start</th><th>End</th><th>Capacity type</th><th></th></tr></thead>
          {groupedEvents(state, true).map(({ group, events }) => {
            const focus = events.filter((e) => isSub(state, e));
            const other = events.filter((e) => !focus.includes(e));
            const at = focus.length ? other.findIndex((e) => e.id === sub?.afterId) + 1 : -1;
            if (!events.length && group === OTHER_GROUP) return null;
            return (
              <tbody key={group}>
                <tr className="group-row"><th colSpan={8}>{group}
                  <button className="add-in-group" onClick={() => addEvent(group)}>+ Add event</button></th></tr>
                {other.slice(0, at < 0 ? other.length : at).map((e) => row(e))}
                {focus.length > 0 && <>
                  <tr className="focus-row">
                    <td></td><td><b>{sub?.name}</b> <span className="muted">({focus.length})</span></td><td></td><td></td>
                    {timeCells(focus[0], focus.map((e) => e.id))}
                    <td className="muted focus-note">{sameTimes(focus) ? `Start/end apply to all ${sub?.name}` : `${sub?.name} currently have different times; editing sets all of them`}</td><td></td>
                  </tr>
                  {focus.map((e) => row(e, true))}
                </>}
                {at >= 0 && other.slice(at).map((e) => row(e))}
              </tbody>
            );
          })}
        </table>
        <PhaseSchedule state={state} update={update} />
        </div>
      </section>
    </div>
  );
}
