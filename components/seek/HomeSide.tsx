'use client';

import { PEOPLE, type DmThread, type PersonKey } from '@/lib/seek/data';
import { useSeek } from '@/lib/seek/store';
import { Ic } from './icons';
import { Avatar } from './ui';

/**
 * Home, like Slack: one sidebar with your channels and your direct messages. These two lists are shared by the
 * Home (channels) screen and a DM opened from Home, so the sidebar stays the same while the chat changes.
 */
export function ChannelList({ active, onOpen }: { active: string | null; onOpen: (id: string) => void }) {
  const { s } = useSeek();
  const ws = s.workspaces[s.wsId];
  return (
    <>
      {ws.channels.map((x) => (
        <button key={x.id} type="button" className={'si' + (x.id === active ? ' on' : '') + (x.unread ? ' unread' : '')} aria-current={x.id === active ? 'page' : undefined} onClick={() => onOpen(x.id)}>
          <span className="h" title={x.private ? 'Private channel' : undefined}>
            {x.private ? <Ic n="lock" size={14} /> : <Ic n="hash" size={14} />}
          </span>
          <span className="x">
            <b>{x.id}</b>
          </span>
          {x.unread ? <span className="badge">{x.unread}</span> : x.tier ? <span className="tag">{x.tier}</span> : null}
        </button>
      ))}
    </>
  );
}

export function DmList({ active, onOpen }: { active: string | null; onOpen: (k: PersonKey) => void }) {
  const { s } = useSeek();
  const threads = (Object.entries(s.dms) as [PersonKey, DmThread][]).filter(([k]) => k !== 'AH');
  if (!threads.length) return null;
  return (
    <>
      {threads.map(([k, t]) => (
        <button key={k} type="button" className={'si dmi' + (k === active ? ' on' : '') + (t.unread ? ' unread' : '')} aria-current={k === active ? 'page' : undefined} onClick={() => onOpen(k)}>
          <Avatar k={k} size={22} presence />
          <span className="x">
            <b>{PEOPLE[k]?.name ?? 'Someone'}</b>
          </span>
          {t.unread ? <span className="badge">{t.unread}</span> : null}
        </button>
      ))}
    </>
  );
}
