'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { connectGoogle, disconnectGoogle, finishGoogle, googleStatus, type GoogleStatus } from '@/lib/seek/gcal';
import { connectZoom, disconnectZoom, finishZoom, zoomStatus, type ZoomStatus } from '@/lib/seek/zoom';
import { useSeek } from '@/lib/seek/store';
import { Ic } from './icons';

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
  const [g, setG] = useState<GoogleStatus | null>(null);
  const [z, setZ] = useState<ZoomStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // back from Google's or Zoom's consent screen (?code&state, or ?error): finish connecting, then tidy the address.
    // Zoom's state starts with "zoom."; anything else came from Google.
    const q = new URLSearchParams(location.search);
    const code = q.get('code');
    const state = q.get('state') ?? '';
    const cancelled = q.get('error');
    const isZoom = state.startsWith('zoom.');
    if (code || cancelled) history.replaceState(null, '', location.pathname);
    void (async () => {
      if (cancelled) toast(`Connecting ${isZoom ? 'Zoom' : 'Google'} was cancelled`);
      else if (code && state) {
        setBusy(true);
        const err = isZoom ? await finishZoom(code, state) : await finishGoogle(code, state);
        setBusy(false);
        toast(
          err ??
            (isZoom
              ? 'Zoom connected. New Zoom meetings get their link automatically'
              : 'Google connected. New Google Meet meetings get a link and a calendar invite automatically'),
        );
        // connected from somewhere else (the schedule dialog): go back there
        let back: string | null = null;
        try {
          back = sessionStorage.getItem('seek.afterConnect');
          sessionStorage.removeItem('seek.afterConnect');
        } catch {}
        if (!err && back && back.startsWith('/') && !back.startsWith('//')) {
          setTimeout(() => location.assign(back!), 1500);
          return;
        }
      }
      const [gs, zs] = await Promise.all([googleStatus(true), zoomStatus(true)]);
      setG(gs);
      setZ(zs);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    const e = await fn();
    if (e) {
      setBusy(false);
      toast(e);
    }
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
          about="Meetings you schedule with “Google Meet” get a Meet link and go into your Google Calendar, with invitations emailed to the guests. Huddles and calls use Google Meet too. Cancelling in Seek cancels the event. If Google says it “hasn’t verified this app”, choose Advanced → Go to Seek."
          st={g}
          busy={busy}
          setupHint="Not set up yet: an admin adds the Google client ID and secret in Supabase (Edge Functions → Secrets)."
          onConnect={() => void connect(connectGoogle)}
          onDisconnect={async () => {
            if (!confirm('Disconnect Google? Meetings already scheduled keep their links.')) return;
            setBusy(true);
            const e = await disconnectGoogle();
            setBusy(false);
            toast(e ?? 'Google disconnected');
            setG(await googleStatus(true));
          }}
        />
        <AppCard
          name="Zoom"
          icon={ZOOM_ICON}
          about="Meetings you schedule with “Zoom” get a Zoom meeting in your Zoom account and its join link on the meeting card. Huddles use Zoom when Google isn’t connected. Cancelling in Seek deletes the Zoom meeting."
          st={z}
          busy={busy}
          setupHint="Not set up yet: an admin adds the Zoom client ID and secret in Supabase (Edge Functions → Secrets)."
          onConnect={() => void connect(connectZoom)}
          onDisconnect={async () => {
            if (!confirm('Disconnect Zoom? Meetings already scheduled keep their links.')) return;
            setBusy(true);
            const e = await disconnectZoom();
            setBusy(false);
            toast(e ?? 'Zoom disconnected');
            setZ(await zoomStatus(true));
          }}
        />
      </div>
    </>
  );
}
