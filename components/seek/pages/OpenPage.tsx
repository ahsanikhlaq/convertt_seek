'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { flashMessage } from '@/lib/seek/liveDecisions';
import { convOfMessage, openConversation } from '@/lib/seek/liveExtras';
import { toUiId } from '@/lib/seek/live';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';

/** Where a copied message link lands (/open?m=<id>): opens the conversation and highlights the message. */
export function OpenPage() {
  const { s, update, setUI } = useSeek();
  const router = useRouter();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (s.session !== 'in' && s.session !== 'client') return;
    const id = Number(new URLSearchParams(location.search).get('m'));
    if (!Number.isInteger(id) || id <= 0) {
      router.replace(s.session === 'client' ? ROUTES.clients : ROUTES.channels);
      return;
    }
    void (async () => {
      const conv = await convOfMessage(id);
      if (!conv) {
        setMissing(true);
        return;
      }
      const route = await openConversation(conv, update, s.meId ?? null);
      setUI({ chTab: 'Messages', thread: null });
      router.replace(route);
      flashMessage(toUiId(id));
    })();
  }, [s.session]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pg" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      {missing ? (
        <div className="empty">
          This message was deleted, or you don&apos;t have access to its conversation.
          <br />
          <br />
          <button type="button" className="btn pri" onClick={() => router.replace(s.session === 'client' ? ROUTES.clients : ROUTES.channels)}>
            Go to Seek
          </button>
        </div>
      ) : (
        <p className="sub">Opening the message…</p>
      )}
    </div>
  );
}
