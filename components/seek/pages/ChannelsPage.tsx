'use client';

import { useEffect, useState } from 'react';
import { backendOn } from '@/lib/seek/backend';
import { WORKSPACES, type PersonKey } from '@/lib/seek/data';
import { useLiveChat } from '@/lib/seek/live';
import { channelId } from '@/lib/seek/format';
import { useSeek } from '@/lib/seek/store';
import { PromptDialog } from '../Dialogs';
import { InviteDialog } from '../InviteDialog';
import { ChannelMembersDialog, NewChannelDialog } from '../ChannelDialogs';
import { Composer, Feed, ThreadPane, useSendTo, type FeedRef } from '../Messages';
import { MainHeader, Shell, Sidebar } from '../Shell';
import { Avatar } from '../ui';
import { FileList, useAttach } from '../Files';
import { startHuddle } from '@/lib/seek/liveExtras';
import { CanvasEditor, PinsList, SavedDialog, ScheduledDialog, TasksDialog, useSchedule } from '../Extras';
import { channelFiles, type SharedFile } from '@/lib/seek/liveFiles';

const TEAM: PersonKey[] = ['AH', 'SY', 'MO', 'ZA'];
const TABS = ['Messages', 'Files', 'Canvas', 'Pins'];

export function ChannelsPage() {
  const { s, ui, update, setUI, toast } = useSeek();
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [membersOf, setMembersOf] = useState<string | null>(null);
  const [listing, setListing] = useState<null | 'saved' | 'tasks' | 'scheduled'>(null);
  const myOpenTasks = (s.ltasks ?? []).filter((t) => t.status === 'open' && t.owner === s.meId).length;
  // with a backend: real channels and messages, live (lib/seek/live.ts); in demo mode this is null
  const live = useLiveChat();
  const team: PersonKey[] = live ? live.people : TEAM;
  const wsId = s.wsId;
  const ws = s.workspaces[wsId];
  const ch = ws.channels.find((c) => c.id === ws.ch) ? ws.ch : ws.channels[0]?.id ?? 'general';
  const c = ws.channels.find((x) => x.id === ch) ?? { id: ch, unread: 0, desc: '' };
  const feed: FeedRef = { get: (d) => (d.workspaces[wsId].msgs[ch] ||= []), where: ch, threads: true };
  const send = useSendTo(feed);
  const attach = useAttach(live && c.cid ? { channel: c.cid } : null);
  const schedule = useSchedule(live && c.cid ? { channel: c.cid } : null, team);

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
      title={backendOn ? s.ws.name : WORKSPACES[wsId].name}
      sub={backendOn ? `Team · ${ws.channels.length} channels · ${team.length} ${team.length === 1 ? 'person' : 'people'}` : WORKSPACES[wsId].sub}
      action={
        <button type="button" className="btn sm" onClick={() => setCreating(true)} aria-label="New channel">
          ＋
        </button>
      }
    >
      <div className="sg lbl">Channels</div>
      {ws.channels.map((x) => (
        <button key={x.id} type="button" className={'si' + (x.id === ch ? ' on' : '') + (x.unread ? ' unread' : '')} aria-current={x.id === ch ? 'page' : undefined} onClick={() => open(x.id)}>
          <span className="h" title={x.private ? 'Private channel' : undefined}>{x.private ? '🔒' : '#'}</span>
          <span className="x">
            <b>{x.id}</b>
          </span>
          {x.unread ? <span className="badge">{x.unread}</span> : x.tier ? <span className="tag">{x.tier}</span> : null}
        </button>
      ))}
      {!live && (
        <button type="button" className="si" onClick={() => toast('Browse all ' + ws.channels.length + ' channels')}>
          ＋ Browse channels
        </button>
      )}
      {live && (
        <button type="button" className="si" onClick={() => setCreating(true)}>
          ＋ New channel
        </button>
      )}
      {live && (
        <button type="button" className="si" onClick={() => setInviting(true)}>
          ＋ Invite people
        </button>
      )}
      {live && <div className="sg lbl">You</div>}
      {live && (
        <button type="button" className="si" onClick={() => setListing('tasks')}>
          <span className="h">☐</span>
          <span className="x">
            <b>Tasks</b>
          </span>
          {myOpenTasks > 0 && <span className="tag">{myOpenTasks}</span>}
        </button>
      )}
      {live && (
        <button type="button" className="si" onClick={() => setListing('saved')}>
          <span className="h">★</span>
          <span className="x">
            <b>Saved</b>
          </span>
          {(s.lsaved?.length ?? 0) > 0 && <span className="tag">{s.lsaved!.length}</span>}
        </button>
      )}
      {live && (
        <button type="button" className="si" onClick={() => setListing('scheduled')}>
          <span className="h">⏱</span>
          <span className="x">
            <b>Scheduled</b>
          </span>
        </button>
      )}
      {!live && <div className="sg lbl">Starred</div>}
      {!live && (
        <button type="button" className="si" onClick={() => open(ws.channels[0].id)}>
          <span className="h">★</span>
          <span className="x">
            <b>{ws.channels[0].id}</b>
            <small>pinned brief</small>
          </span>
        </button>
      )}
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
    const showJump = !live && wsId === 'C' && ch === 'launch-squad' && !s.seenNew;
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
        <Composer key={wsId + ch} placeholder={'Message #' + ch} people={team} onSend={(t) => (live ? void live.send(ch, t) : send(t))} onAttach={attach} onSchedule={schedule} />
      </>
    );
  } else if (live && ui.chTab === 'Files') {
    body = (
      <div className="pg">
        <ChannelFiles key={c.cid} cid={c.cid ?? null} me={live.me} name={ch} />
      </div>
    );
  } else if (live) {
    body = (
      <div className="pg">
        {ui.chTab === 'Canvas' ? <CanvasEditor key={c.cid} channel={c.cid ?? null} me={live.me} name={ch} /> : <PinsList key={c.cid} target={c.cid ? { channel: c.cid } : null} me={live.me} where={'#' + ch} reloadKey={(s.workspaces.C.msgs[ch] ?? []).filter((m) => m.kind === 'msg' && m.pinned).length} />}
      </div>
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
    <Shell active="channels" side={side} pane={ui.thread != null ? <ThreadPane feed={feed} people={team} onReply={live ? (root, t, also) => void live.reply(ch, root, t, also) : undefined} /> : undefined}>
      <MainHeader
        title={(c.private ? '🔒 ' : '# ') + ch}
        sub={c.desc}
        right={
          <>
            <span className="stack hide-m">
              {(live ? team.slice(0, 3) : (['SY', 'MO', 'AH'] as PersonKey[])).map((k) => (
                <Avatar key={k} k={k} size={26} />
              ))}
            </span>
            <button
              type="button"
              className="btn sm hide-m"
              title={live ? 'Normal: mentions and replies notify · Digest: waits for the summary · Mute: only mentions' : undefined}
              onClick={async () => {
                if (live) {
                  // your level for this channel: Normal → Digest → Mute
                  const cur = c.tier === 'Digest' ? 'digest' : c.tier === 'Muted' ? 'mute' : 'normal';
                  const next = cur === 'normal' ? 'digest' : cur === 'digest' ? 'mute' : 'normal';
                  const err = await live.setLevel(ch, next);
                  toast(err ?? (next === 'mute' ? '#' + ch + ' muted. Mentions still reach you' : next === 'digest' ? '#' + ch + ' set to Digest' : '#' + ch + ' notifies as normal'));
                  return;
                }
                const o = ['Normal', 'Digest', 'Mute'];
                const n = o[(o.indexOf(s.notif) + 1) % o.length];
                update((d) => {
                  d.notif = n;
                });
                toast('Notifications: ' + n);
              }}
            >
              🔔 {live ? (c.tier === 'Muted' ? 'Mute' : c.tier ?? 'Normal') : s.notif}
            </button>
            {live && c.private && (
              <button type="button" className="btn sm" onClick={() => setMembersOf(ch)} aria-label={'Members of #' + ch}>
                👥 <span className="hide-m">Members</span>
              </button>
            )}
            <button type="button" className="btn sm" onClick={async () => {
                if (!live) return toast('🎧 Huddle started · others can join');
                if (!c.cid) return;
                const err = await startHuddle({ channel: c.cid });
                toast(err ?? '🎧 Huddle started · everyone in #' + ch + ' can join');
              }}>
              🎧 Huddle
            </button>
          </>
        }
        below={tabs}
      />
      {body}
      {listing === 'saved' && <SavedDialog me={live?.me ?? null} onClose={() => setListing(null)} />}
      {listing === 'tasks' && <TasksDialog me={live?.me ?? null} onClose={() => setListing(null)} />}
      {listing === 'scheduled' && <ScheduledDialog onClose={() => setListing(null)} />}
      {creating && live && (
        <NewChannelDialog
          live={live}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setUI({ thread: null, chTab: 'Messages', sideOpen: false, menu: null });
          }}
        />
      )}
      {membersOf && live && <ChannelMembersDialog live={live} channel={membersOf} onClose={() => setMembersOf(null)} />}
      {creating && !live && (
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
      {inviting && live && (
        <InviteDialog
          onClose={() => setInviting(false)}
          invite={live.invite}
          admin={live.admin}
          channels={[...live.channels.values()].filter((x) => x.private).map((x) => ({ id: x.id, name: x.name }))}
        />
      )}
    </Shell>
  );
}

/** Backend mode: every file shared in the channel, newest first (live as new ones arrive). */
function ChannelFiles({ cid, me, name }: { cid: string | null; me: string | null; name: string }) {
  const { s } = useSeek();
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  // reload when a new message with files arrives in this channel
  const withFiles = (s.workspaces.C.msgs[name] ?? []).filter((m) => m.kind === 'msg' && m.files?.length).length;
  useEffect(() => {
    if (!cid) return;
    let alive = true;
    void channelFiles(cid).then((f) => alive && setFiles(f ?? []));
    return () => {
      alive = false;
    };
  }, [cid, withFiles]);
  return <FileList files={cid ? files : []} me={me} empty={'No files yet. Use ＋ in the message box (or drop files on it) to share one in #' + name + '.'} />;
}
