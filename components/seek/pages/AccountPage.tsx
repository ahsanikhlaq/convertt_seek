'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { backendOn, removeAvatar, saveProfile, signInMethods, signOut, signOutOthers, uploadAvatar } from '@/lib/seek/backend';
import { PEOPLE } from '@/lib/seek/data';
import { enterSends, setEnterSends, setShowPreviews, showPreviews } from '@/lib/seek/prefs';
import { ROUTES } from '@/lib/seek/routes';
import { setMe, useSeek } from '@/lib/seek/store';
import { ConfirmDialog } from '../Dialogs';
import { PauseSelect } from '../PauseSelect';
import { AlsoNotify, ChannelExceptions, DesktopBanners, Keywords, Schedule, WhatToNotify } from '../NotifySettings';
import { usePopovers } from '../Popovers';
import { ClientRail, MainHeader, Shell } from '../Shell';
import { SoundSettings } from '../SoundSettings';
import { Avatar, ModeSeg, Switch } from '../ui';
import { Ic } from '../icons';

/**
 * Account settings: everything about you that isn't in the quick profile panel, in tabs like Slack's preferences.
 * Most settings are saved to your account (they follow you to other devices); "Messages & media" are per device.
 */
const TABS = [
  ['profile', 'Profile', 'Your name, photo and working hours', 'user'],
  ['notifications', 'Notifications', 'What notifies you, keywords, schedule and sounds', 'bell'],
  ['messages', 'Messages & media', 'How the message box and pictures behave', 'message'],
  ['appearance', 'Appearance', 'Light or dark, and your colours', 'palette'],
  ['region', 'Language & region', 'Your time zone', 'globe'],
  ['security', 'Account & security', 'Sign-in and devices', 'lock'],
] as const;
type Tab = (typeof TABS)[number][0];

export function AccountPage() {
  const { s, setUI } = useSeek();
  const router = useRouter();
  const q = useSearchParams();
  const tab = (TABS.find((t) => t[0] === q.get('tab'))?.[0] ?? 'profile') as Tab;
  const go = (t: Tab) => {
    router.replace(ROUTES.account + '?tab=' + t, { scroll: false });
    setUI({ sideOpen: false });
  };
  // keep the open tab in view on narrow screens, where the tab bar scrolls sideways
  useEffect(() => {
    document.querySelector('.acct-tabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [tab]);
  return (
    <Shell active="account" side={null} wide rail={s.session === 'client' ? <ClientRail /> : undefined}>
      <MainHeader
        title="Account settings"
        sub={'Signed in as ' + s.me.email}
        below={
          <div className="tabs acct-tabs" role="tablist" aria-label="Account settings">
            {TABS.map(([k, l, , icon]) => (
              <button key={k} type="button" role="tab" id={'at-' + k} aria-selected={tab === k} aria-controls="acct-panel" className={'tb' + (tab === k ? ' on' : '')} onClick={() => go(k)}>
                <Ic n={icon} />
                {l}
              </button>
            ))}
          </div>
        }
      />
      <div className="pg">
        <div className="acct" role="tabpanel" id="acct-panel" aria-labelledby={'at-' + tab}>
          {tab === 'profile' && <ProfileTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'messages' && <MessagesTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'region' && <RegionTab />}
          {tab === 'security' && <SecurityTab />}
        </div>
      </div>
    </Shell>
  );
}

function ProfileTab() {
  const { s, update, toast } = useSeek();
  const [name, setName] = useState(s.me.name);
  const [title, setTitle] = useState(s.me.title);
  const [pronouns, setPronouns] = useState(s.me.pronouns ?? '');
  const [hours, setHours] = useState(s.me.workHours ?? '09:00–18:00');
  const [busy, setBusy] = useState(false);
  const photoIn = useRef<HTMLInputElement>(null);
  const hasPhoto = !!PEOPLE.AH?.photo;
  const changed = name !== s.me.name || title !== s.me.title || pronouns !== (s.me.pronouns ?? '') || hours !== (s.me.workHours ?? '09:00–18:00');

  const photo = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) return toast('Choose a PNG, JPG or WebP image up to 5 MB');
    setBusy(true);
    const r = await uploadAvatar(f);
    setBusy(false);
    if (r.error || !r.url) return toast(r.error ?? 'Couldn’t upload the photo');
    PEOPLE.AH = { ...PEOPLE.AH, photo: r.url };
    update(() => {});
    toast('Photo updated');
  };
  const dropPhoto = async () => {
    setBusy(true);
    const err = await removeAvatar();
    setBusy(false);
    if (err) return toast(err);
    PEOPLE.AH = { ...PEOPLE.AH, photo: undefined };
    update(() => {});
    toast('Photo removed');
  };
  const save = async () => {
    const n = name.trim() || s.me.name;
    const ti = title.trim();
    if (backendOn) {
      setBusy(true);
      const err = await saveProfile({ name: n, title: ti, pronouns: pronouns.trim(), workHours: hours.trim() || '09:00–18:00' });
      setBusy(false);
      if (err) return toast(err);
    }
    setMe(n);
    update((d) => {
      d.me.name = n;
      d.me.title = ti;
      d.me.pronouns = pronouns.trim();
      d.me.workHours = hours.trim() || '09:00–18:00';
    });
    toast('Profile saved');
  };

  return (
    <>
      <section className="acard">
        <h3>Photo</h3>
<div className="abody">
        <div className="aphoto">
          <Avatar k="AH" size={72} />
          {backendOn ? (
            <div className="acts">
              <button type="button" className="btn sm" disabled={busy} onClick={() => photoIn.current?.click()}>
                {hasPhoto ? 'Change photo' : 'Upload a photo'}
              </button>
              {hasPhoto && (
                <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void dropPhoto()}>
                  Remove
                </button>
              )}
              <small>PNG, JPG or WebP, up to 5 MB.</small>
            </div>
          ) : (
            <small>Photos need a signed-in account.</small>
          )}
          <input
            ref={photoIn}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              void photo(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
</section>
      <section className="acard">
        <h3>About you</h3>
<div className="abody">
        <div className="grid2">
          <div className="fld">
            <label htmlFor="ac-n">Display name</label>
            <input className="inp" id="ac-n" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="fld">
            <label htmlFor="ac-t">Title</label>
            <input className="inp" id="ac-t" maxLength={80} placeholder="e.g. Account lead" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="fld">
            <label htmlFor="ac-p">Pronouns</label>
            <input className="inp" id="ac-p" maxLength={30} placeholder="e.g. she/her" value={pronouns} onChange={(e) => setPronouns(e.target.value)} />
          </div>
          <div className="fld">
            <label htmlFor="ac-h">Working hours</label>
            <input className="inp" id="ac-h" maxLength={40} value={hours} onChange={(e) => setHours(e.target.value)} />
            <em>Shown to teammates, so they know when you&apos;ll reply.</em>
          </div>
        </div>
        <div className="aact">
          <button type="button" className="btn pri" disabled={!changed || busy} onClick={() => void save()}>
            Save changes
          </button>
        </div>
      </div>
</section>
    </>
  );
}

function NotificationsTab() {
  const { s, update, toast } = useSeek();
  const [email, setEmail] = useState<'instant' | 'daily' | 'off'>(s.me.notifyEmail ?? 'instant');
  const saveEmail = async (v: typeof email) => {
    setEmail(v);
    if (backendOn) {
      const err = await saveProfile({ name: s.me.name, title: s.me.title, notifyEmail: v });
      if (err) return toast(err);
    }
    update((d) => {
      d.me.notifyEmail = v;
    });
    toast('Email notifications saved');
  };
  return (
    <>
      <section className="acard">
        <h3>Pause</h3>
<div className="abody">
        <PauseSelect id="ac-pause" />
      </div>
</section>
      <section className="acard">
        <h3>Notify me about</h3>
<div className="abody">
        <WhatToNotify />
      </div>
</section>
      <section className="acard">
        <h3>Also notify me about</h3>
<div className="abody">
        <AlsoNotify />
      </div>
</section>
      <section className="acard">
        <h3>Keywords</h3>
<div className="abody">
        <Keywords />
      </div>
</section>
      <section className="acard">
        <h3>Notification schedule</h3>
<div className="abody">
        <Schedule />
      </div>
</section>
      <section className="acard">
        <h3>Desktop notifications</h3>
<div className="abody">
        <DesktopBanners />
      </div>
</section>
      <section className="acard">
        <h3>Sound</h3>
<div className="abody">
        <SoundSettings bare />
      </div>
</section>
      {s.session === 'in' && (
        <section className="acard">
          <h3>Channel-specific notifications</h3>
<div className="abody">
          <p className="ahint">Exceptions to your default for single channels. You can also change it with the bell in the channel header.</p>
          <ChannelExceptions />
        </div>
</section>
      )}
      <section className="acard">
        <h3>Email</h3>
<div className="abody">
        <div className="fld">
          <label htmlFor="ac-e">Email me about notifications</label>
          <select id="ac-e" className="inp" value={email} onChange={(e) => void saveEmail(e.target.value as typeof email)}>
            <option value="instant">As they happen (when I&apos;m not in Seek)</option>
            <option value="daily">Once a day (summary)</option>
            <option value="off">Never</option>
          </select>
          <em>Emails go to {s.me.email}. Your choice is saved now; emails start once Seek’s email sending is set up. In-app notifications always show under the bell.</em>
        </div>
      </div>
</section>
    </>
  );
}

function MessagesTab() {
  const { toast } = useSeek();
  const [enter, setEnter] = useState(true);
  const [prev, setPrev] = useState(true);
  useEffect(() => {
    setEnter(enterSends());
    setPrev(showPreviews());
  }, []);
  return (
    <section className="acard">
      <h3>On this device</h3>
<div className="abody">
      <div className="fld">
        <label htmlFor="ac-enter">When I press Enter in the message box</label>
        <select
          id="ac-enter"
          className="inp"
          value={enter ? 'send' : 'line'}
          onChange={(e) => {
            const on = e.target.value === 'send';
            setEnter(on);
            setEnterSends(on);
            toast(on ? 'Enter sends your message' : 'Ctrl/⌘ + Enter sends your message');
          }}
        >
          <option value="send">Send the message (Shift + Enter for a new line)</option>
          <option value="line">Start a new line (Ctrl/⌘ + Enter sends)</option>
        </select>
      </div>
      <div className="trow">
        <div>
          <b>Show picture previews</b>
          <small>Off: pictures show as file cards you click to open.</small>
        </div>
        <Switch
          on={prev}
          label="Show picture previews"
          onClick={() => {
            setPrev(!prev);
            setShowPreviews(!prev);
            toast(prev ? 'Picture previews off' : 'Picture previews on');
          }}
        />
      </div>
    </div>
</section>
  );
}

function AppearanceTab() {
  const pop = usePopovers();
  return (
    <>
      <section className="acard">
        <h3>Light or dark</h3>
<div className="abody">
        <ModeSeg />
        <em className="ahint">System follows your computer&apos;s setting.</em>
      </div>
</section>
      <section className="acard">
        <h3>Theme and branding</h3>
<div className="abody">
        <p className="ahint">Sidebar, background and accent colours. Saved to your account, so they follow you to other devices.</p>
        <div>
          <button type="button" className="btn" onClick={(e) => pop.toggleTheme(e.currentTarget)}>
            <Ic n="palette" /> Change colours
          </button>
        </div>
      </div>
</section>
    </>
  );
}

const zones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
};

function RegionTab() {
  const { s, update, toast } = useSeek();
  const here = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const list = zones();
  const all = list.includes(s.me.tz) || !s.me.tz ? list : [s.me.tz, ...list];
  const [tz, setTz] = useState(s.me.tz || here);
  const save = async (v: string) => {
    setTz(v);
    if (backendOn) {
      const err = await saveProfile({ name: s.me.name, title: s.me.title, timeZone: v });
      if (err) return toast(err);
    }
    update((d) => {
      d.me.tz = v;
    });
    toast('Time zone saved');
  };
  const time = (() => {
    try {
      return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
    } catch {
      return '';
    }
  })();
  return (
    <section className="acard">
      <h3>Time zone</h3>
<div className="abody">
      <div className="fld">
        <label htmlFor="ac-tz">Your time zone</label>
        {all.length ? (
          <select id="ac-tz" className="inp" value={tz} onChange={(e) => void save(e.target.value)}>
            {all.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        ) : (
          <input id="ac-tz" className="inp" value={tz} onChange={(e) => setTz(e.target.value)} onBlur={() => void save(tz)} />
        )}
        <em>
          {time && 'It’s ' + time + ' for you. '}Teammates see your local time, and reminders and scheduled messages use it.
        </em>
      </div>
      {here && here !== tz && (
        <div>
          <button type="button" className="btn sm" onClick={() => void save(here)}>
            Use this computer&apos;s time zone ({here.replace(/_/g, ' ')})
          </button>
        </div>
      )}
    </div>
</section>
  );
}

function SecurityTab() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const [methods, setMethods] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<'others' | null>(null);
  useEffect(() => {
    if (backendOn) void signInMethods().then(setMethods);
  }, []);
  const out = async () => {
    if (backendOn) await signOut();
    update((d) => {
      d.session = 'out';
    });
    router.push(ROUTES.signup);
    toast('Signed out');
  };
  return (
    <>
      <section className="acard">
        <h3>Sign-in</h3>
<div className="abody">
        <div className="kv">
          <div>
            <span>Email</span>
            <b>{s.me.email}</b>
          </div>
          <div>
            <span>Signs in with</span>
            <b>{backendOn ? (methods ? methods.join(' or ') || 'Email code' : '…') : 'Email code'}</b>
          </div>
          <div>
            <span>Password</span>
            <b>None. Seek emails you a 6-digit code, so there&apos;s no password to steal.</b>
          </div>
        </div>
      </div>
</section>
      <section className="acard">
        <h3>Devices</h3>
<div className="abody">
        <p className="ahint">Lost a laptop or used a shared computer? Sign out everywhere except here.</p>
        <div className="aact" style={{ justifyContent: 'flex-start' }}>
          {backendOn && (
            <button type="button" className="btn" onClick={() => setConfirm('others')}>
              Sign out of other devices
            </button>
          )}
          <button type="button" className="btn danger" onClick={() => void out()}>
            Sign out
          </button>
        </div>
      </div>
</section>
      {confirm === 'others' && (
        <ConfirmDialog
          title="Sign out of other devices?"
          body="Every other browser and app signed in as you will need a new email code. You stay signed in here."
          confirm="Sign out others"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            const err = await signOutOthers();
            toast(err ?? 'Signed out of your other devices');
          }}
        />
      )}
    </>
  );
}
