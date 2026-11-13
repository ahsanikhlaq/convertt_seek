'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { currentAccount, forgetAccount, preferOrg } from '@/lib/seek/backend';
import type { Note } from '@/lib/seek/data';
import { markNotesRead, openNote } from '@/lib/seek/liveNotes';
import { useSeek } from '@/lib/seek/store';
import { Avatar } from './ui';
import { Ic, type IconKey } from './icons';

const ICON: Record<Note['kind'], IconKey> = { dm: 'mail', mention: 'at', reply: 'reply', client: 'users', team: 'users', approval: 'check', task: 'task', reminder: 'alarm', channel: 'hash', keyword: 'star', huddle: 'huddle' };

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.round(m / 60);
  return h < 24 ? h + 'h' : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** The 🔔 button with its unread count, and the list it opens (backend mode). */
export function NotesBell({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | 'none'>('none');
  const box = useRef<HTMLDivElement>(null);
  const notes = s.notes ?? [];
  const unread = notes.filter((n) => !n.read).length;

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) setPerm(Notification.permission);
  }, [open]);

  // close on a click outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = async (n: Note) => {
    setOpen(false);
    // from another workspace you're in: switch to it and open the message there
    if (n.ws && s.orgId && n.ws !== s.orgId && (s.orgs ?? []).some((o) => o.id === n.ws)) {
      if (!n.read) await markNotesRead([n.id]);
      preferOrg(n.ws);
      forgetAccount();
      location.assign(n.messageId ? '/open?m=' + n.messageId : '/channels');
      return;
    }
    const me = (await currentAccount())?.id ?? null;
    let to = '';
    update((d) => {
      to = openNote(n, d, me);
      const x = d.notes?.find((y) => y.id === n.id);
      if (x) x.read = true;
    });
    if (!n.read) void markNotesRead([n.id]);
    router.push(to || '/channels');
  };

  const readAll = () => {
    update((d) => {
      for (const n of d.notes ?? []) n.read = true;
    });
    void markNotesRead('all');
  };

  const askDesktop = async () => {
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      toast(p === 'granted' ? 'Desktop alerts are on' : 'Desktop alerts are blocked in your browser settings');
    } catch {
      toast('This browser doesn’t support desktop alerts');
    }
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        type="button"
        className={'btn ' + (size === 'sm' ? 'sm ' : '') + 'ghost'}
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
        aria-expanded={open}
      >
        <Ic n="bell" size={18} />{unread > 0 && <span className="badge" style={{ marginLeft: 2 }}>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notes" role="dialog" aria-label="Notifications">
          <div className="nh">
            <b>Notifications</b>
            {unread > 0 && (
              <button type="button" className="linkbtn" onClick={readAll}>
                Mark all read
              </button>
            )}
          </div>
          {perm === 'default' && (
            <button type="button" className="ndesk" onClick={askDesktop}>
              <Ic n="monitor" /> Get desktop alerts when Seek isn’t in front
            </button>
          )}
          <div className="nl">
            {notes.length ? (
              notes.map((n) => (
                <button key={n.id} type="button" className={'ni' + (n.read ? '' : ' unread')} onClick={() => void go(n)}>
                  {n.actor ? <Avatar k={n.actor} size={30} /> : <span className="av" style={{ width: 30, height: 30 }}><Ic n={ICON[n.kind]} /></span>}
                  <span className="x">
                    <b>{n.title}</b>
                    {n.ws && s.orgId && n.ws !== s.orgId && <small className="notews">in {(s.orgs ?? []).find((o) => o.id === n.ws)?.name ?? 'another workspace'}</small>}
                    <small>{n.body}</small>
                  </span>
                  <span className="t">{ago(n.at)}</span>
                </button>
              ))
            ) : (
              <div className="empty" style={{ padding: 24 }}>
                Nothing yet. Mentions, DMs, thread replies and client messages will show here.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
