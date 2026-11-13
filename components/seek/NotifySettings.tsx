'use client';

import { useEffect, useRef, useState } from 'react';
import { backendOn, DEFAULT_NOTIFY, saveNotify, sb, type NotifyPrefs, type NotifySchedule } from '@/lib/seek/backend';
import { inSchedule } from '@/lib/seek/prefs';
import { useSeek } from '@/lib/seek/store';
import { Switch } from './ui';

/**
 * Slack-style notification preferences: what notifies you, threads and huddles, keywords, a schedule, desktop
 * banners, and per-channel exceptions. Saved to your account (private to you) a moment after each change.
 */
export function useNotifyPrefs() {
  const { s, update, toast } = useSeek();
  const np = s.me.notify ?? DEFAULT_NOTIFY;
  const save = async (patch: Partial<NotifyPrefs>, said = 'Saved') => {
    update((d) => {
      d.me.notify = { ...(d.me.notify ?? DEFAULT_NOTIFY), ...patch };
    });
    if (backendOn) {
      const err = await saveNotify(patch);
      if (err) return toast(err);
    }
    if (said) toast(said);
  };
  return { np, save };
}

const LEVELS: [NotifyPrefs['level'], string, string][] = [
  ['all', 'Everything', 'Every new message in channels you can see, plus DMs and mentions'],
  ['mentions', 'DMs, mentions and keywords', 'Recommended. Thread replies and huddles too, if they’re on below'],
  ['nothing', 'Nothing', 'No sounds or banners. Everything still shows in 🔔'],
];

export function WhatToNotify() {
  const { np, save } = useNotifyPrefs();
  return (
    <div className="nlevels" role="radiogroup" aria-label="Notify me about">
      {LEVELS.map(([k, l, d]) => (
        <label key={k} className={'nlevel' + (np.level === k ? ' on' : '')}>
          <input type="radio" name="nlevel" checked={np.level === k} onChange={() => void save({ level: k }, 'You’ll be notified about: ' + l.toLowerCase())} />
          <span>
            <b>{l}</b>
            <small>{d}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

export function AlsoNotify() {
  const { np, save } = useNotifyPrefs();
  return (
    <>
      <div className="trow">
        <div>
          <b>Replies in threads I’m in</b>
          <small>Threads you started or replied to</small>
        </div>
        <Switch on={np.threads} label="Replies in threads I’m in" onClick={() => void save({ threads: !np.threads }, np.threads ? 'Thread replies won’t notify you' : 'Thread replies will notify you')} />
      </div>
      <div className="trow">
        <div>
          <b>Huddles that start in my channels</b>
          <small>When someone starts a huddle where you can join</small>
        </div>
        <Switch on={np.huddles} label="Huddles that start in my channels" onClick={() => void save({ huddles: !np.huddles }, np.huddles ? 'Huddles won’t notify you' : 'Huddles will notify you')} />
      </div>
    </>
  );
}

export function Keywords() {
  const { np, save } = useNotifyPrefs();
  const [draft, setDraft] = useState('');
  const add = () => {
    const words = draft
      .split(',')
      .map((w) => w.trim().replace(/\s+/g, ' ').slice(0, 40))
      .filter((w) => w && !np.keywords.some((k) => k.toLowerCase() === w.toLowerCase()));
    setDraft('');
    if (!words.length) return;
    const next = [...np.keywords, ...words].slice(0, 25);
    void save({ keywords: next }, words.length === 1 ? '“' + words[0] + '” added' : words.length + ' keywords added');
  };
  return (
    <div className="fld">
      <label htmlFor="kw-in">Notify me when someone writes</label>
      <div className="kwbox">
        {np.keywords.map((k) => (
          <span key={k} className="kw">
            {k}
            <button type="button" aria-label={'Remove ' + k} onClick={() => void save({ keywords: np.keywords.filter((x) => x !== k) }, '“' + k + '” removed')}>
              ×
            </button>
          </span>
        ))}
        <input
          id="kw-in"
          className="kwin"
          placeholder={np.keywords.length ? 'Add another' : 'e.g. your client’s name, “launch”, “invoice”'}
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && np.keywords.length) {
              void save({ keywords: np.keywords.slice(0, -1) }, '');
            }
          }}
          onBlur={add}
        />
      </div>
      <em>Whole words, not case-sensitive. Works in channels you can see and threads you’re in, but not in muted channels. Only you can see your keywords.</em>
    </div>
  );
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS = [1, 2, 3, 4, 5];

export function Schedule() {
  const { s } = useSeek();
  const { np, save } = useNotifyPrefs();
  const [sch, setSch] = useState<NotifySchedule>(np.schedule ?? { days: WEEKDAYS, from: '09:00', to: '18:00' });
  const on = !!np.schedule;
  const first = useRef(true);
  // times and days save a moment after the last change
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!on) return;
    const id = setTimeout(() => void save({ schedule: sch }, 'Schedule saved'), 600);
    return () => clearTimeout(id);
  }, [sch.from, sch.to, sch.days.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const preset = sch.days.join() === WEEKDAYS.join() ? 'weekdays' : sch.days.length === 7 ? 'every' : 'custom';
  const now = inSchedule(on ? sch : null, s.me.tz);
  return (
    <>
      <div className="trow">
        <div>
          <b>Only notify me at certain times</b>
          <small>Outside these hours Seek stays quiet, as if paused</small>
        </div>
        <Switch on={on} label="Only notify me at certain times" onClick={() => void save({ schedule: on ? null : sch }, on ? 'Schedule off: notifications any time' : 'Schedule on')} />
      </div>
      {on && (
        <div className="nsched">
          <div className="chips">
            {(
              [
                ['weekdays', 'Weekdays', WEEKDAYS],
                ['every', 'Every day', [0, 1, 2, 3, 4, 5, 6]],
              ] as const
            ).map(([k, l, days]) => (
              <button key={k} type="button" className={'chip' + (preset === k ? ' on' : '')} aria-pressed={preset === k} onClick={() => setSch({ ...sch, days: [...days] })}>
                {l}
              </button>
            ))}
            <span className={'chip' + (preset === 'custom' ? ' on' : '')} style={{ cursor: 'default' }}>
              Custom
            </span>
          </div>
          <div className="ndays" role="group" aria-label="Days">
            {DAYS.map((d, i) => {
              const sel = sch.days.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  className={'nday' + (sel ? ' on' : '')}
                  aria-pressed={sel}
                  aria-label={DAY_NAMES[i]}
                  title={DAY_NAMES[i]}
                  onClick={() => {
                    const days = sel ? sch.days.filter((x) => x !== i) : [...sch.days, i].sort();
                    if (days.length) setSch({ ...sch, days });
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="grid2">
            <div className="fld">
              <label htmlFor="ns-f">From</label>
              <input id="ns-f" type="time" className="inp" value={sch.from} onChange={(e) => e.target.value && setSch({ ...sch, from: e.target.value })} />
            </div>
            <div className="fld">
              <label htmlFor="ns-t">To</label>
              <input id="ns-t" type="time" className="inp" value={sch.to} onChange={(e) => e.target.value && setSch({ ...sch, to: e.target.value })} />
            </div>
          </div>
          <em className="ahint">
            In your time zone{s.me.tz ? ' (' + s.me.tz.replace(/_/g, ' ') + ')' : ''}. Right now you {now ? 'are inside' : 'are outside'} your schedule.
          </em>
        </div>
      )}
    </>
  );
}

export function DesktopBanners() {
  const { np, save } = useNotifyPrefs();
  return (
    <>
      <div className="trow">
        <div>
          <b>Show desktop notifications</b>
          <small>A banner when Seek isn’t the window you’re looking at</small>
        </div>
        <Switch on={np.desktop} label="Show desktop notifications" onClick={() => void save({ desktop: !np.desktop }, np.desktop ? 'Desktop notifications off' : 'Desktop notifications on')} />
      </div>
      <div className="trow">
        <div>
          <b>Include a preview of the message</b>
          <small>Off: banners say who and where, not what. Handy when sharing your screen</small>
        </div>
        <Switch on={np.preview} label="Include a preview of the message" onClick={() => void save({ preview: !np.preview }, np.preview ? 'Message previews hidden' : 'Message previews shown')} />
      </div>
    </>
  );
}

type Level = 'normal' | 'all' | 'digest' | 'mute';
const TIER: Record<Level, string | undefined> = { normal: undefined, all: 'Everything', digest: 'Digest', mute: 'Muted' };

/** Exceptions per channel: Default, Everything, Digest or Muted (only mentions). */
export function ChannelExceptions() {
  const { s, update, toast } = useSeek();
  const chans = s.workspaces.C.channels.filter((c) => c.cid);
  if (!backendOn || s.session !== 'in' || !chans.length) return <p className="ahint">Join a channel to set its notifications here.</p>;
  const levelOf = (tier?: string): Level => (tier === 'Everything' ? 'all' : tier === 'Digest' ? 'digest' : tier === 'Muted' ? 'mute' : 'normal');
  const set = async (cid: string, name: string, level: Level) => {
    const { error } = await sb().from('channel_prefs').upsert({ channel_id: cid, level, muted_until: null }, { onConflict: 'user_id,channel_id' });
    if (error) return toast('Couldn’t save that. Try again');
    update((d) => {
      const c = d.workspaces.C.channels.find((x) => x.cid === cid);
      if (c) c.tier = TIER[level];
    });
    toast('#' + name + ': ' + (level === 'normal' ? 'your default' : level === 'all' ? 'every new message' : level === 'digest' ? 'digest' : 'muted (mentions only)'));
  };
  return (
    <div className="nchans">
      {chans.map((c) => (
        <div key={c.cid} className="nchan">
          <b>
            {c.private ? '🔒 ' : '# '}
            {c.id}
          </b>
          <select className="inp" aria-label={'Notifications for #' + c.id} value={levelOf(c.tier)} onChange={(e) => void set(c.cid!, c.id, e.target.value as Level)}>
            <option value="normal">Default</option>
            <option value="all">Every new message</option>
            <option value="digest">Digest only</option>
            <option value="mute">Muted (mentions only)</option>
          </select>
        </div>
      ))}
    </div>
  );
}
