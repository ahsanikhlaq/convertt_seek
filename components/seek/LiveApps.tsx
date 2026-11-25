'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { connectGoogle, disconnectGoogle, finishGoogle, googleStatus, knownGoogleStatus, type GoogleStatus } from '@/lib/seek/gcal';
import { connectZoom, disconnectZoom, finishZoom, knownZoomStatus, zoomStatus, type ZoomStatus } from '@/lib/seek/zoom';
import { useSeek } from '@/lib/seek/store';
import { Ic } from './icons';
import { useConfirm } from './Dialogs';

type Status = GoogleStatus | ZoomStatus;

const GOOGLE_ICON = (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#4285F4" strokeWidth="1.6" />
    <path d="M3 9h18" stroke="#4285F4" strokeWidth="1.6" />
    <path d="M8 2.5v3M16 2.5v3" stroke="#4285F4" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M8 13.5h3v3H8z" fill="#34A853" />
    <path d="M13 13.5h3v3h-3z" fill="#FBBC04" />
  </svg>
);

const ZOOM_ICON = (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#0B5CFF" />
    <rect x="5" y="8" width="9.5" height="8" rx="2" fill="#fff" />
    <path d="M15.5 11l3.5-2.3v6.6L15.5 13z" fill="#fff" />
  </svg>
);

function AppCard(p: {
  name: string;
  icon: ReactNode;
  about: string;
  st: Status | null;
  busy: boolean;
  setupHint: string;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { st } = p;
  return (
    <div className={'lapp' + (st?.connected ? ' on' : '')}>
      <span className="lapp-ic" aria-hidden="true">
        {p.icon}
      </span>
      <div className="lapp-t">
        <b>{p.name}</b>
        <small>{p.about}</small>
        {st?.connected && (
          <span className="lapp-st">
            <Ic n="check" size={13} /> Connected as {st.email || 'your account'}
          </span>
        )}
        {st && !st.configured && <span className="lapp-st warn">{p.setupHint}</span>}
      </div>
      <div className="lapp-a">
        {!st ? (
          <span className="sub">Checking…</span>
        ) : st.connected ? (
          <button type="button" className="btn sm" disabled={p.busy} onClick={p.onDisconnect}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="btn sm pri" disabled={p.busy || !st.configured} onClick={p.onConnect}>
            Connect
          </button>
        )}
      </div>
    </div>
  );
}

/** Apps you can connect (backend mode): Google Calendar & Meet, and Zoom, per person. */
export function LiveApps() {
  const { toast } = useSeek();
  const [ask, confirmDialog] = useConfirm();
  // shown at once from what this device last saw, then refreshed from the server
  const [g, setG] = useState<GoogleStatus | null>(() => knownGoogleStatus());
  const [z, setZ] = useState<ZoomStatus | null>(() => knownZoomStatus());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // back from Google's or Zoom's consent screen (?code&state, or ?error): finish connecting, then tidy the address.
    // Zoom's state starts with "zoom."; another state came from Google; with no state, the app we sent you to (saved
    // when Connect was clicked) says whose it is.
    const q = new URLSearchParams(location.search);
    const code = q.get('code');
    const state = q.get('state') ?? '';
    const failed = q.get('error');
    const read = (k: string): string | null => {
      try {
        return sessionStorage.getItem(k);
      } catch {
        return null;
      }
    };
    const drop = (k: string) => {
      try {
        sessionStorage.removeItem(k);
      } catch {}
    };
    const hint = read('seek.connecting');
    const provider: 'google' | 'zoom' | null = state ? (state.startsWith('zoom.') ? 'zoom' : 'google') : hint === 'zoom' || hint === 'google' ? hint : null;
    const label = provider === 'zoom' ? 'Zoom' : provider === 'google' ? 'Google' : '';
    const returning = !!(code || failed);
    if (returning) {
      history.replaceState(null, '', location.pathname);
      drop('seek.connecting');
    }
    // a failed or cancelled attempt: don't go back to the old page on a later, unrelated connect
    const dropAfterConnect = () => drop('seek.afterConnect');
    void (async () => {
      if (failed) {
        dropAfterConnect();
        const what = label ? 'Connecting ' + label : 'Connecting the app';
        toast(failed === 'access_denied' ? what + ' was cancelled' : what + ' didn’t work (' + failed.replace(/[^\w.-]/g, '').slice(0, 40) + '). Try again');
      } else if (code && state && provider) {
        setBusy(true);
        let r: { error: string | null; email: string };
        try {
          r = provider === 'zoom' ? await finishZoom(code, state) : await finishGoogle(code, state);
        } catch {
          r = { error: `Couldn’t connect ${label}. Try again`, email: '' };
        } finally {
          setBusy(false);
        }
        if (r.error) {
          dropAfterConnect();
          toast(r.error);
        } else {
          // connected: show it at once (no need to wait for the status check)
          const st = { configured: true, connected: true, email: r.email };
          if (provider === 'zoom') setZ(st);
          else setG(st);
          toast(provider === 'zoom' ? 'Zoom connected. New Zoom meetings get their link automatically' : 'Google connected. New Google Meet meetings get a link and a calendar invite automatically');
          // connected from somewhere else (the schedule dialog): go back there
          const back = read('seek.afterConnect');
          dropAfterConnect();
          if (back && back.startsWith('/') && !back.startsWith('//')) {
            setTimeout(() => location.assign(back), 1500);
            return;
          }
        }
        // the other app's card (and this one's, after a failure) from the server
        await Promise.all([
          provider === 'google' && !r.error ? null : googleStatus(true).then((gs) => gs && setG(gs)),
          provider === 'zoom' && !r.error ? null : zoomStatus(true).then((zs) => zs && setZ(zs)),
        ]);
        return;
      } else if (returning) dropAfterConnect();
      // each shows as soon as it arrives; a failed check keeps what is shown
      await Promise.all([googleStatus(true).then((gs) => gs && setG(gs)), zoomStatus(true).then((zs) => zs && setZ(zs))]);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    let e: string | null;
    try {
      e = await fn();
    } catch {
      e = 'Couldn’t start connecting. Check your connection';
    } finally {
      // on success the browser is already leaving for the consent screen; if that is stopped, or you come Back to
      // this page, the buttons must work again
      setBusy(false);
    }
    if (e) toast(e);
  };

  const disconnect = async (title: string, fn: () => Promise<string | null>, status: (fresh: boolean) => Promise<Status | null>, set: (st: Status) => void) => {
    if (!(await ask({ title: `Disconnect ${title}?`, body: 'Meetings already scheduled keep their links. You can connect again at any time.', confirm: 'Disconnect', danger: true }))) return;
    setBusy(true);
    let e: string | null;
    try {
      e = await fn();
    } catch {
      e = 'Couldn’t disconnect. Check your connection';
    } finally {
      setBusy(false);
    }
    toast(e ?? `${title} disconnected`);
    // a failed status check keeps what is shown
    const st = await status(true);
    if (st) set(st);
  };

  return (
    <>
      <div className="intro">
        <div>
          <h2>Connected apps</h2>
          <p>Connect the tools your team already uses. Each person connects their own account.</p>
        </div>
      </div>
      <div className="lapps">
        <AppCard
          name="Google Calendar & Meet"
          icon={GOOGLE_ICON}
          about="Meetings you schedule with “Google Meet” get a Meet link and go into your Google Calendar, with invitations emailed to the guests. Huddles and calls use Google Meet too. Cancelling in Seek cancels the event. If Google says it “hasn’t verified this app”, choose Advanced → Go to Seek, and tick the calendar box."
          st={g}
          busy={busy}
          setupHint="Not set up yet: an admin adds the Google client ID and secret in Supabase (Edge Functions → Secrets)."
          onConnect={() => void connect(connectGoogle)}
          onDisconnect={() => void disconnect('Google', disconnectGoogle, googleStatus, setG)}
        />
        <AppCard
          name="Zoom"
          icon={ZOOM_ICON}
          about="Meetings you schedule with “Zoom” get a Zoom meeting in your Zoom account and its join link on the meeting card. Huddles use Zoom when Google isn’t connected. Cancelling in Seek deletes the Zoom meeting."
          st={z}
          busy={busy}
          setupHint="Not set up yet: an admin adds the Zoom client ID and secret in Supabase (Edge Functions → Secrets)."
          onConnect={() => void connect(connectZoom)}
          onDisconnect={() => void disconnect('Zoom', disconnectZoom, zoomStatus, setZ)}
        />
      </div>
      {confirmDialog}
    </>
  );
}
