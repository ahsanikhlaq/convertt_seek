'use client';

import { useEffect, useState } from 'react';
import { backendOn } from '@/lib/seek/backend';
import { WORKSPACES, type PersonKey } from '@/lib/seek/data';
import { useLiveChat } from '@/lib/seek/liveProvider';
import { channelId } from '@/lib/seek/format';
import { useSeek } from '@/lib/seek/store';
import { Modal, PromptDialog } from '../Dialogs';
import { Composer, Feed, ThreadPane, useSendTo, type FeedRef } from '../Messages';
import { MainHeader, Shell, Sidebar } from '../Shell';
import { Avatar, OrgMark } from '../ui';
import { FileList, useAttach } from '../Files';
import { startHuddle } from '@/lib/seek/liveExtras';
import { CanvasEditor, PinsList, SavedDialog, ScheduledDialog, TasksDialog, useSchedule } from '../Extras';
import { channelFiles, type SharedFile } from '@/lib/seek/liveFiles';
import { Ic } from '../icons';
import { ChannelList, DmList } from '../HomeSide';
import { NotifyMenu, type Level } from '../NotifyMenu';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/seek/routes';
import dynamic from 'next/dynamic';

// dialogs open on a click, so they load then (not with the page)
const InviteDialog = dynamic(() => import('../InviteDialog').then((m) => m.InviteDialog), { ssr: false });
const NewChannelDialog = dynamic(() => import('../ChannelDialogs').then((m) => m.NewChannelDialog), { ssr: false });
const ChannelMembersDialog = dynamic(() => import('../ChannelDialogs').then((m) => m.ChannelMembersDialog), { ssr: false });
const BrowseChannelsDialog = dynamic(() => import('../ChannelDialogs').then((m) => m.BrowseChannelsDialog), { ssr: false });
const CatchUpDialog = dynamic(() => import('../AiDialogs').then((m) => m.CatchUpDialog), { ssr: false });
const WorkspaceSettings = dynamic(() => import('../WorkspaceSettings').then((m) => m.WorkspaceSettings), { ssr: false });

const TEAM: PersonKey[] = ['AH', 'SY', 'MO', 'ZA'];
const TABS = ['Messages', 'Files', 'Canvas', 'Pins'];

export function ChannelsPage() {
  const { s, ui, update, setUI, toast } = useSeek();
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [membersOf, setMembersOf] = useState<string | null>(null);
  const [listing, setListing] = useState<null | 'saved' | 'tasks' | 'scheduled'>(null);
  const [catchUp, setCatchUp] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const myOpenTasks = (s.ltasks ?? []).filter((t) => t.status === 'open' && t.owner === s.meId).length;
  // with a backend: real channels and messages, live (lib/seek/live.ts); in demo mode this is null
  const live = useLiveChat();
  // Home also lists your direct messages (kept live for the whole app by lib/seek/liveProvider.tsx)
  const router = useRouter();
  const openDm = (k: PersonKey) => {
    update((d) => {
      d.dm = k;
      const t = d.dms[k];
      if (t) t.unread = 0;
    });
    setUI({ home: true, sideOpen: false, menu: null, thread: null });
    router.push(ROUTES.dms);
  };
  const team: PersonKey[] = live ? live.people : TEAM;
  const wsId = s.wsId;
  const ws = s.workspaces[wsId];
  const ch = ws.channels.find((c) => c.id === ws.ch) ? ws.ch : ws.channels[0]?.id ?? '';
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

  const wsName = backendOn ? s.ws.name : WORKSPACES[wsId].name;
  // Home: your quick links first, then Channels and Direct messages (each folds away from its header, with a +)
  const side = (
    <Sidebar
      mark={String(wsName || 'S').charAt(0).toUpperCase()}
      title={wsName}
      onTitle={live ? () => setWsOpen(true) : undefined}
      titleHint={live ? (live.admin ? 'Workspace settings' : 'About this workspace') : undefined}
      sub={backendOn ? `Team · ${ws.channels.length} ${ws.channels.length === 1 ? 'channel' : 'channels'} · ${team.length} ${team.length === 1 ? 'person' : 'people'}` : WORKSPACES[wsId].sub}
      action={
        <button type="button" className="btn sm" onClick={() => setCreating(true)} aria-label="New channel">
          <Ic n="plus" size={18} />
        </button>
      }
    >
      {live && (
        <button type="button" className="si qk" onClick={() => setListing('tasks')}>
          <span className="h"><Ic n="task" size={14} /></span>
          <span className="x">
            <b>Tasks</b>
          </span>
          {myOpenTasks > 0 && <span className="tag">{myOpenTasks}</span>}
        </button>
      )}
      {live && (
        <button type="button" className="si qk" onClick={() => setListing('saved')}>
          <span className="h"><Ic n="star" size={14} /></span>
          <span className="x">
            <b>Saved</b>
          </span>
          {(s.lsaved?.length ?? 0) > 0 && <span className="tag">{s.lsaved!.length}</span>}
        </button>
      )}
      {live && (
        <button type="button" className="si qk" onClick={() => setListing('scheduled')}>
          <span className="h"><Ic n="clock" size={14} /></span>
          <span className="x">
            <b>Scheduled</b>
          </span>
        </button>
      )}
      <button type="button" className="sg lbl sgb" data-sec="ch" title="Show or hide">
        Channels
      </button>
      {live && (
        <button type="button" className="sgadd" data-sec="ch" aria-label="New channel" title="New channel" onClick={() => setCreating(true)}>
          <Ic n="plus" size={14} />
        </button>
      )}
      <ChannelList active={ch} onOpen={open} />
      {!live && (
        <button type="button" className="si util" data-sec="ch" onClick={() => toast('Browse all ' + ws.channels.length + ' channels')}>
          <Ic n="plus" size={14} /> Browse channels
        </button>
      )}
      {live && (
        <button type="button" className="si util" data-sec="ch" onClick={() => setBrowsing(true)}>
          <Ic n="search" size={14} /> Browse channels
        </button>
      )}
      {live && (
        <button type="button" className="sg lbl sgb" data-sec="dm" title="Show or hide">
          Direct messages
        </button>
      )}
      {live && (
        <button
          type="button"
          className="sgadd"
          data-sec="dm"
          aria-label="New message"
          title="New message"
          onClick={() => {
            setUI({ home: true, sideOpen: false });
            router.push(ROUTES.dms);
          }}
        >
          <Ic n="plus" size={14} />
        </button>
      )}
      {live && <DmList active={null} onOpen={openDm} />}
      {live && (
        <button type="button" className="si sinv" onClick={() => setInviting(true)}>
          <Ic n="plus" size={14} /> Invite people
        </button>
      )}
      {!live && <div className="sg lbl">Starred</div>}
      {!live && (
        <button type="button" className="si" onClick={() => open(ws.channels[0].id)}>
          <span className="h"><Ic n="star" size={14} /></span>
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
        <Feed feed={feed} />
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
            <Ic n="down" size={14} /> 2 new messages
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

  // a workspace with no channels yet: invite the team to create the first one
  if (live && !ws.channels.length)
    return (
      <Shell active="channels" side={side}>
        <MainHeader title={s.ws.name || 'Your workspace'} sub="No channels yet" />
        <div className="pg">
          <div className="nochan">
            <span className="nochan-ic">
              <Ic n="hash" size={26} />
            </span>
            <h2>{live.ready ? 'Create your first channel' : 'Loading your channels…'}</h2>
            {live.ready && (
              <>
                <p>Channels are where your team talks about a project, a topic or a client. Everyone on the team can join public channels; private ones are for the people you add.</p>
                <div className="nochan-acts">
                  {live.channels.size > 0 && (
                    <button type="button" className="btn" onClick={() => setBrowsing(true)}>
                      <Ic n="search" size={16} /> Browse channels
                    </button>
                  )}
                  <button type="button" className="btn pri" onClick={() => setCreating(true)}>
                    <Ic n="plus" size={16} /> Create a channel
                  </button>
                  <button type="button" className="btn" onClick={() => setInviting(true)}>
                    <Ic n="users" size={16} /> Invite people
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {creating && (
          <NewChannelDialog
            live={live}
            onClose={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              setUI({ thread: null, chTab: 'Messages', sideOpen: false, menu: null });
            }}
          />
        )}
        {inviting && <InviteDialog onClose={() => setInviting(false)} invite={live.invite} channels={[...live.channels.values()].map((x) => ({ id: x.id, name: x.name }))} admin={live.admin} />}
        {browsing && <BrowseChannelsDialog live={live} onClose={() => setBrowsing(false)} onOpen={open} />}
      </Shell>
    );

  return (
    <Shell active="channels" side={side} pane={ui.thread != null ? <ThreadPane feed={feed} people={team} onReply={live ? (root, t, also) => void live.reply(ch, root, t, also) : undefined} /> : undefined}>
      <MainHeader
        title={<span className="mtl">{c.private ? <Ic n="lock" size={16} /> : <Ic n="hash" size={16} />}{ch}</span>}
        sub={live ? s.ws.name + (c.desc ? ' · ' + c.desc : '') : c.desc}
        right={
          <>
            <span className="stack hide-m">
              {(live ? team.slice(0, 3) : (['SY', 'MO', 'AH'] as PersonKey[])).map((k) => (
                <Avatar key={k} k={k} size={26} />
              ))}
            </span>
            <NotifyMenu
              channel={ch}
              value={
                (live
                  ? c.tier === 'Digest' ? 'digest' : c.tier === 'Muted' ? 'mute' : c.tier === 'Everything' ? 'all' : 'normal'
                  : ({ Normal: 'normal', Everything: 'all', Digest: 'digest', Mute: 'mute' } as Record<string, Level>)[s.notif] ?? 'normal') as Level
              }
              onPick={async (next) => {
                if (live) {
                  const err = await live.setLevel(ch, next);
                  toast(err ?? (next === 'mute' ? '#' + ch + ' muted. Mentions still reach you' : next === 'digest' ? '#' + ch + ' set to Digest' : next === 'all' ? 'Every new message in #' + ch + ' notifies you' : '#' + ch + ' follows your default'));
                  return;
                }
                const n = next === 'all' ? 'Everything' : next === 'digest' ? 'Digest' : next === 'mute' ? 'Mute' : 'Normal';
                update((d) => {
                  d.notif = n;
                });
                toast('Notifications: ' + n);
              }}
            />
            {live && c.cid && (
              <button type="button" className="btn sm" onClick={() => setMembersOf(ch)} aria-label={'Members of #' + ch} title="Members and channel settings">
                <Ic n="users" /> <span className="hide-m">Members</span>
              </button>
            )}
            {live && c.cid && (
              <button type="button" className="btn sm" onClick={() => setCatchUp(true)} title="An AI summary of the latest messages">
                <Ic n="ai" /> <span className="hide-m">Catch up</span>
              </button>
            )}
            <button type="button" className="btn sm hud" onClick={async () => {
                if (!live) return toast('Huddle started · others can join');
                if (!c.cid) return;
                const err = await startHuddle({ channel: c.cid });
                toast(err ?? 'Huddle started · everyone in #' + ch + ' can join');
              }}>
              <Ic n="huddle" /> <span className="hide-m">Huddle</span>
            </button>
          </>
        }
        below={tabs}
      />
      {body}
      {listing === 'saved' && <SavedDialog me={live?.me ?? null} onClose={() => setListing(null)} />}
      {wsOpen && live?.admin && <WorkspaceSettings onClose={() => setWsOpen(false)} />}
      {wsOpen && live && !live.admin && (
        <Modal
          title={
            <span className="joinorg">
              <OrgMark name={s.ws.name} logo={s.ws.logo} size={28} />
              {s.ws.name}
            </span>
          }
          onClose={() => setWsOpen(false)}
          width={420}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setWsOpen(false);
                  setInviting(true);
                }}
              >
                <Ic n="users" /> Invite people
              </button>
              <button type="button" className="btn pri" onClick={() => setWsOpen(false)}>
                Done
              </button>
            </>
          }
        >
          <div className="mb">
            <div className="kv">
              <div>
                <span>People</span>
                <b>{team.length}</b>
              </div>
              <div>
                <span>Your channels</span>
                <b>{ws.channels.length}</b>
              </div>
              <div>
                <span>Your role</span>
                <b>Member</b>
              </div>
            </div>
            <small style={{ color: 'var(--mu)' }}>Only the workspace&apos;s owners and admins can change its name, logo and people. Ask one of them if something needs changing.</small>
          </div>
        </Modal>
      )}
      {catchUp && c.cid && <CatchUpDialog conv={'ch:' + c.cid} where={'#' + ch} onClose={() => setCatchUp(false)} />}
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
      {browsing && live && <BrowseChannelsDialog live={live} onClose={() => setBrowsing(false)} onOpen={open} />}
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
  return <FileList files={cid ? files : []} me={me} empty={'No files yet. Use the + button in the message box (or drop files on it) to share one in #' + name + '.'} />;
}
