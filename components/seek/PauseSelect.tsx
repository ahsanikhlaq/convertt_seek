'use client';

import { backendOn, saveStatus } from '@/lib/seek/backend';
import { isPaused, PAUSE_FOR, untilLabel } from '@/lib/seek/prefs';
import { useSeek } from '@/lib/seek/store';

/** Pause notifications for a while (a dropdown), or turn them back on. Saved so it follows you to other devices. */
export function PauseSelect({ id = 'pause' }: { id?: string }) {
  const { s, update, toast } = useSeek();
  const paused = isPaused(s.me);
  const pick = async (v: string) => {
    const opt = PAUSE_FOR.find((o) => o[0] === v);
    const until = opt ? new Date(Date.now() + opt[2] * 60_000).toISOString() : null;
    if (backendOn) {
      const err = await saveStatus({ dndUntil: until });
      if (err) return toast(err);
    }
    update((d) => {
      d.me.dnd = !!until;
      d.me.dndUntil = until;
    });
    toast(opt ? 'Notifications paused for ' + opt[1] : 'Notifications are on');
  };
  return (
    <div className="fld">
      <label htmlFor={id}>Pause notifications</label>
      <select id={id} className="inp" value={paused ? 'paused' : 'on'} onChange={(e) => void pick(e.target.value)}>
        {paused ? <option value="paused">Paused {untilLabel(s.me.dndUntil) || ''}</option> : <option value="on">Not paused</option>}
        {paused && <option value="on">Turn notifications back on</option>}
        {PAUSE_FOR.map(([v, l]) => (
          <option key={v} value={v}>
            {(paused ? 'Pause for ' : 'For ') + l}
          </option>
        ))}
      </select>
      <em>No sounds or desktop alerts while paused; everything still shows under the bell. They come back on by themselves.</em>
    </div>
  );
}
