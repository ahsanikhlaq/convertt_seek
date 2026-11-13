'use client';

import { useEffect, useRef, useState } from 'react';
import { backendOn, saveSound } from '@/lib/seek/backend';
import { playSound, SOUNDS, type SoundKey } from '@/lib/seek/sounds';
import { useSeek } from '@/lib/seek/store';
import { Ic } from './icons';

/**
 * Notification settings: the sound (six to choose from, with a preview), its volume, which notifications play it,
 * and how long desktop alerts stay on screen. Saved to your account a moment after each change.
 */
export function SoundSettings({ bare }: { bare?: boolean }) {
  const { s, update, toast } = useSeek();
  const cur = s.me.sound ?? { key: 'chime', volume: 70, play: 'all' as const, alertSecs: 8 };
  const [v, setV] = useState(cur);
  const first = useRef(true);
  const canAlert = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState(canAlert ? Notification.permission : 'denied');

  // save a moment after the last change
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(async () => {
      const err = backendOn ? await saveSound(v) : null;
      if (err) return toast(err);
      update((d) => {
        d.me.sound = v;
      });
      toast('Notification settings saved');
    }, 700);
    return () => clearTimeout(id);
  }, [v.key, v.volume, v.play, v.alertSecs]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sndset">
      {!bare && (
        <div className="lbl" style={{ marginBottom: 2 }}>
          Notifications
        </div>
      )}
      <div className="fld">
        <label htmlFor="snd-k">Sound</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            id="snd-k"
            className="inp"
            value={v.key}
            onChange={(e) => {
              setV({ ...v, key: e.target.value });
              playSound(e.target.value as SoundKey, v.volume);
            }}
          >
            {SOUNDS.map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
          <button type="button" className="btn" aria-label="Play the sound" title="Play" onClick={() => playSound(v.key as SoundKey, v.volume)}>
            <Ic n="play" size={14} />
          </button>
        </div>
      </div>
      <div className="fld">
        <label htmlFor="snd-v">
          Volume <span style={{ color: 'var(--sb)', fontWeight: 400 }}>{v.volume}%</span>
        </label>
        <input
          id="snd-v"
          type="range"
          min={0}
          max={100}
          step={5}
          value={v.volume}
          onChange={(e) => setV({ ...v, volume: Number(e.target.value) })}
          onPointerUp={() => playSound(v.key as SoundKey, v.volume)}
          onKeyUp={() => playSound(v.key as SoundKey, v.volume)}
          style={{ width: '100%', accentColor: 'var(--v)' }}
        />
      </div>
      <div className="grid2">
        <div className="fld">
          <label htmlFor="snd-p">Play the sound for</label>
          <select id="snd-p" className="inp" value={v.play} onChange={(e) => setV({ ...v, play: e.target.value as typeof v.play })}>
            <option value="all">Every notification</option>
            <option value="important">DMs, mentions, approvals</option>
            <option value="off">Nothing (silent)</option>
          </select>
        </div>
        <div className="fld">
          <label htmlFor="snd-a">Desktop alerts stay</label>
          <select id="snd-a" className="inp" value={v.alertSecs} onChange={(e) => setV({ ...v, alertSecs: Number(e.target.value) })}>
            <option value={4}>4 seconds</option>
            <option value={8}>8 seconds</option>
            <option value={15}>15 seconds</option>
            <option value={0}>Until I close them</option>
          </select>
        </div>
      </div>
      {canAlert && perm !== 'granted' && (
        <button
          type="button"
          className="btn sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            const r = await Notification.requestPermission();
            setPerm(r);
            toast(r === 'granted' ? 'Desktop alerts are on' : 'Desktop alerts stay off (you can allow them in your browser settings)');
          }}
        >
          Turn on desktop alerts
        </button>
      )}
      <em style={{ fontSize: 12, color: 'var(--sb)' }}>While your status is Focus time, only DMs and mentions make a sound or alert.</em>
    </div>
  );
}
