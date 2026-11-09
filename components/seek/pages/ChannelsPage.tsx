'use client';

import { useState } from 'react';
import { WORKSPACES, type PersonKey } from '@/lib/seek/data';
import { channelId } from '@/lib/seek/format';
import { useSeek } from '@/lib/seek/store';
import { PromptDialog } from '../Dialogs';
import { Composer, Feed, ThreadPane, useSendTo, type FeedRef } from '../Messages';
import { MainHeader, Shell, Sidebar } from '../Shell';
import { Avatar } from '../ui';

const TEAM: PersonKey[] = ['AH', 'SY', 'MO', 'ZA'];
const TABS = ['Messages', 'Files', 'Canvas', 'Pins'];

export function ChannelsPage() {
  const { s, ui, update, setUI, toast } = useSeek();
  const [creating, setCreating] = useState(false);
  const wsId = s.wsId;
  const ws = s.workspaces[wsId];
  const ch = ws.channels.find((c) => c.id === ws.ch) ? ws.ch : ws.channels[0].id;
  const c = ws.channels.find((x) => x.id === ch)!;
  const feed: FeedRef = { get: (d) => (d.workspaces[wsId].msgs[ch] ||= []), where: ch, threads: true };
  const send = useSendTo(feed);

  const open = (id: string) => {
    update((d) => {
      const w = d.workspaces[wsId];
      w.ch = id;
      const x = w.channels.find((y) => y.id === id);
      if (x) x.unread = 0;
    });
    setUI({ thread: null, chTab: 'Messages', sideOpen: false, menu: null });
  };

  const side = (
    <Sidebar
      title={WORKSPACES[wsId].name}
      sub={WORKSPACES[wsId].sub}
      action={
        <button type="button" className="btn sm" onClick={() => setCreating(true)} aria-label="New channel">
          ＋
        </button>
      }
    >
      <div className="sg lbl">Channels</div>
      {ws.channels.map((x) => (
        <button key={x.id} type="button" className={'si' + (x.id === ch ? ' on' : '') + (x.unread ? ' unread' : '')} aria-current={x.id === ch ? 'page' : undefined} onClick={() => open(x.id)}>
          <span className="h">#</span>
          <span className="x">
            <b>{x.id}</b>
          </span>
          {x.unread ? <span className="badge">{x.unread}</span> : x.tier ? <span className="tag">{x.tier}</span> : null}
        </button>
      ))}
      <button type="button" className="si" onClick={() => toast('Browse all ' + ws.channels.length + ' channels')}>
        ＋ Browse channels
      </button>
      <div className="sg lbl">Starred</div>
      <button type="button" className="si" onClick={() => open(ws.channels[0].id)}>
        <span className="h">★</span>
        <span className="x">
          <b>{ws.channels[0].id}</b>
          <small>pinned brief</small>
        </span>
      </button>
    </Sidebar>
  );

  const tabs = (
    <div className="tabs" role="tablist">
      {TABS.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={ui.chTab === t} className={'tb' + (ui.chTab === t ? ' on' : '')} onClick={() => setUI({ chTab: t })}>
          {t}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (ui.chTab === 'Messages') {
    const showJump = wsId === 'C' && ch === 'launch-squad' && !s.seenNew;
    body = (
      <>
        <Feed feed={feed} banner={<div className="daysep">Today</div>} />
        {showJump && (
          <button
            type="button"
            className="jump"
            onClick={() => {
              update((d) => {
                d.seenNew = true;
              });
              const f = document.getElementById('feed');
              if (f) f.scrollTop = f.scrollHeight;
            }}
          >
            ↓ 2 new messages
          </button>
        )}
        <Composer key={wsId + ch} placeholder={'Message #' + ch} people={TEAM} onSend={(t) => send(t)} />
      </>
    );
  } else if (ui.chTab === 'Files') {
    const files: [string, string][] = [
      ['staging-home.png', 'Momina · 1.2 MB · today'],
      ['hero-options.pdf', 'Ahsan · 4 MB · Thu'],
      ['sitemap-v2.fig', 'Syed · Figma · Wed'],
    ];
    body = (
      <div className="pg">
        {files.map((f) => (
          <div key={f[0]} className="file" style={{ maxWidth: 'none' }}>
            <i>{f[0].split('.').pop()!.toUpperCase()}</i>
            <div style={{ flex: 1 }}>
              <b>{f[0]}</b>
              <small>{f[1]}</small>
            </div>
            <button type="button" className="btn sm" onClick={() => toast('Opening ' + f[0])}>
              Open
            </button>
          </div>
        ))}
      </div>
    );
  } else if (ui.chTab === 'Canvas') {
    body = (
      <div className="pg">
        <div className="card">
          <div className="ct">
            <b>Launch brief</b>
            <span className="tag v">Pinned</span>
          </div>
          <p style={{ margin: 0, color: 'var(--mu)' }}>Goal: relaunch hollowbright.com on Wednesday 09:00 London. Owners: Syed (design), Momina (build), Ahsan (client).</p>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="pg">
        <div className="dec" style={{ margin: 0 }}>
          <div className="k">
            <span>PINNED</span>
          </div>
          <b>Launch brief · Wednesday 09:00 London</b>
          <small>Pinned by Ahsan</small>
        </div>
      </div>
    );
  }

  return (
    <Shell active="channels" side={side} pane={ui.thread != null ? <ThreadPane feed={feed} people={TEAM} /> : undefined}>
      <MainHeader
        title={'# ' + ch}
        sub={c.desc}
        right={
          <>
            <span className="stack hide-m">
              <Avatar k="SY" size={26} />
              <Avatar k="MO" size={26} />
              <Avatar k="AH" size={26} />
            </span>
            <button
              type="button"
              className="btn sm hide-m"
              onClick={() => {
                const o = ['Normal', 'Digest', 'Mute'];
                const n = o[(o.indexOf(s.notif) + 1) % o.length];
                update((d) => {
                  d.notif = n;
                });
                toast('Notifications: ' + n);
              }}
            >
              🔔 {s.notif}
            </button>
            <button type="button" className="btn sm" onClick={() => toast('🎧 Huddle started · others can join')}>
              🎧 Huddle
            </button>
          </>
        }
        below={tabs}
      />
      {body}
      {creating && (
        <PromptDialog
          title="Create a channel"
          label="Channel name"
          initial="qa-team"
          confirm="Create channel"
          onCancel={() => setCreating(false)}
          onSubmit={(v) => {
            const id = channelId(v);
            if (!id) return;
            if (ws.channels.some((x) => x.id === id)) {
              toast('#' + id + ' already exists');
              return;
            }
            update((d) => {
              const w = d.workspaces[wsId];
              w.channels.push({ id, unread: 0, desc: 'New channel · 1 member' });
              w.msgs[id] = [];
            });
            setCreating(false);
            open(id);
            toast('#' + id + ' created');
          }}
        />
      )}
    </Shell>
  );
}
