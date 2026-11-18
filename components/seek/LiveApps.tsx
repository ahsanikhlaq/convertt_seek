'use client';

import { useEffect, useState } from 'react';
import { connectGoogle, disconnectGoogle, googleStatus, type GoogleStatus } from '@/lib/seek/google';
import { useSeek } from '@/lib/seek/store';
import { Ic } from './icons';

const GOOGLE_RESULT: Record<string, string> = {
  connected: 'Google connected. New Google Meet meetings get a link and a calendar invite automatically',
  cancelled: 'Connecting Google was cancelled',
  noscope: 'Google was connected without calendar access. Connect again and tick the calendar box',
  error: 'Couldn’t connect Google. Try again',
};

/** Apps you can connect (backend mode): Google Calendar & Meet, per person. */
export function LiveApps() {
  const { toast } = useSeek();
  const [g, setG] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // back from Google's consent screen: say how it went, then tidy the address
    const r = new URLSearchParams(location.search).get('google');
    if (r) {
      toast(GOOGLE_RESULT[r] ?? GOOGLE_RESULT.error);
      history.replaceState(null, '', location.pathname);
    }
    void googleStatus(true).then(setG);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="intro">
        <div>
          <h2>Connected apps</h2>
          <p>Connect the tools your team already uses. Each person connects their own account.</p>
        </div>
      </div>
      <div className="lapps">
        <div className={'lapp' + (g?.connected ? ' on' : '')}>
          <span className="lapp-ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#4285F4" strokeWidth="1.6" />
              <path d="M3 9h18" stroke="#4285F4" strokeWidth="1.6" />
              <path d="M8 2.5v3M16 2.5v3" stroke="#4285F4" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M8 13.5h3v3H8z" fill="#34A853" />
              <path d="M13 13.5h3v3h-3z" fill="#FBBC04" />
            </svg>
          </span>
          <div className="lapp-t">
            <b>Google Calendar &amp; Meet</b>
            <small>
              Meetings you schedule with “Google Meet” get a Meet link and go into your Google Calendar, with invitations
              emailed to the guests. Huddles and calls use Google Meet too. Cancelling in Seek cancels the event.
            </small>
            {g?.connected && (
              <span className="lapp-st">
                <Ic n="check" size={13} /> Connected as {g.email || 'your Google account'}
              </span>
            )}
            {g && !g.configured && (
              <span className="lapp-st warn">
                Not set up yet: an admin adds the Google client ID and secret in Supabase (Edge Functions → Secrets).
              </span>
            )}
          </div>
          <div className="lapp-a">
            {!g ? (
              <span className="sub">Checking…</span>
            ) : g.connected ? (
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={async () => {
                  if (!confirm('Disconnect Google? Meetings already scheduled keep their links.')) return;
                  setBusy(true);
                  const e = await disconnectGoogle();
                  setBusy(false);
                  toast(e ?? 'Google disconnected');
                  setG(await googleStatus(true));
                }}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                className="btn sm pri"
                disabled={busy || !g.configured}
                onClick={async () => {
                  setBusy(true);
                  const e = await connectGoogle();
                  if (e) {
                    setBusy(false);
                    toast(e);
                  }
                }}
              >
                Connect Google
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
