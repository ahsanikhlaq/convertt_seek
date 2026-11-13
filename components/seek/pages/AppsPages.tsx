'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { backendOn, currentAccount } from '@/lib/seek/backend';
import { AGENTS, agentLog, levelName, LEVELS, loadAgents, loadTraining, RUNNING, saveTraining, setAgent, setAiPaused, type AgentKey, type AgentState, type Level, type LogEntry } from '@/lib/seek/liveAgents';
import { Modal } from '../Dialogs';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Switch } from '../ui';
import { Ic } from '../icons';

function AppsSide({ active }: { active: 'apps' | 'agents' }) {
  const { toast, setUI } = useSeek();
  const close = () => setUI({ sideOpen: false });
  return (
    <Sidebar title="Apps" sub="connected tools and AI">
      <div className="sg lbl">Apps</div>
      <Link href={ROUTES.apps} className={'si' + (active === 'apps' ? ' on' : '')} aria-current={active === 'apps' ? 'page' : undefined} onClick={close}>
        <span className="x">
          <b>All apps</b>
        </span>
      </Link>
      {['Automations', 'What reaches clients'].map((l) => (
        <button key={l} type="button" className="si" onClick={() => toast(l)}>
          <span className="x">
            <b>{l}</b>
          </span>
        </button>
      ))}
      <div className="sg lbl">AI</div>
      <button type="button" className="si" onClick={() => toast('Away assistant')}>
        <span className="x">
          <b>Away assistant</b>
        </span>
      </button>
      <Link href={ROUTES.agents} className={'si' + (active === 'agents' ? ' on' : '')} aria-current={active === 'agents' ? 'page' : undefined} onClick={close}>
        <span className="x">
          <b>AI agents</b>
        </span>
      </Link>
    </Sidebar>
  );
}

const LOG: [string, string, string][] = [
  ['09:30', 'Posted Monday standup in #launch-squad', 'Sources: 9 messages'],
  ['09:12', 'Suggested task "Safari menu bug" → accepted by Ahsan', "From Syed's message"],
  ['Yesterday 22:40', 'Answered Chris overnight (client-visible content only)', 'Source: launch plan'],
  ['Yesterday 17:05', 'Flagged mobile hero animation as out of scope', 'Source: SOW v2'],
];

export function AgentsPage() {
  return backendOn ? <LiveAgentsPage /> : <DemoAgentsPage />;
}

/** Backend mode: real settings. Admins switch agents, set levels and pause all AI; everyone sees the log. */
function LiveAgentsPage() {
  const { s, toast } = useSeek();
  const ws = s.orgId ?? null;
  const [admin, setAdmin] = useState(false);
  const [data, setData] = useState<{ settings: Map<AgentKey, AgentState>; paused: boolean } | null>(null);
  const [logOf, setLogOf] = useState<AgentKey | 'all' | null>(null);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [teaching, setTeaching] = useState<AgentKey | null>(null);
  const reload = async () => {
    if (!ws) return;
    const d = await loadAgents(ws);
    if (d) setData(d);
  };
  useEffect(() => {
    void currentAccount().then((a) => setAdmin(!!a?.workspace && ['owner', 'admin'].includes(a.workspace.role)));
    void reload();
  }, [ws]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!logOf || !ws) return;
    setLog(null);
    void agentLog(ws, logOf).then((l) => setLog(l ?? []));
  }, [logOf, ws]);

  const pa = !!data?.paused;
  const running = data ? AGENTS.filter((a) => data.settings.get(a.key)?.enabled).length : 0;
  const change = async (key: AgentKey, next: AgentState, msg: string) => {
    if (!ws) return;
    const err = await setAgent(ws, key, next.enabled, next.level);
    toast(err ?? msg);
    if (!err) await reload();
  };

  return (
    <Shell active="agents" side={<AppsSide active="agents" />}>
      <MainHeader
        title="AI agents"
        sub="Each agent follows the same hard rules, keeps a log, and can be switched off."
        right={
          <button type="button" className="btn sm" onClick={() => setLogOf('all')}>
            Agent log
          </button>
        }
      />
      <div className="pg">
        <div className="intro">
          <div>
            <h2>Your agents</h2>
            <p>{data ? `${pa ? 0 : running} of ${AGENTS.length} switched on${pa ? ' · all paused' : ''}` : 'Loading…'}</p>
          </div>
          <div className={'pause' + (pa ? ' on' : '')} title={admin ? undefined : 'Only admins can change agents'}>
            <div>
              <b>{pa ? 'All AI paused' : 'Pause all AI'}</b>
              <small>admins only</small>
            </div>
            <Switch
              on={pa}
              danger
              disabled={!admin || !data}
              label="Pause all AI"
              onClick={async () => {
                if (!ws) return;
                const err = await setAiPaused(ws, !pa);
                toast(err ?? (pa ? 'AI resumed' : 'All AI paused for everyone'));
                if (!err) await reload();
              }}
            />
          </div>
        </div>
        <div className="banner v" style={{ margin: 0 }}>
          <Ic n="ai" size={14} />{' '}
          <span>
            Agents are set up but not running yet: they start once the AI connection is added (a Claude API key, saved on the
            server by an admin). Your choices here are kept and apply from then on.
          </span>
        </div>
        {pa && (
          <div className="banner gold" style={{ margin: 0 }}>
            <Ic n="pause" /> <span>All AI is paused for everyone. Agents keep their settings and resume when you turn this off.</span>
          </div>
        )}
        <div className="ag">
          {AGENTS.map((a) => {
            const st = data?.settings.get(a.key) ?? { enabled: a.on, level: a.level };
            return (
              <div key={a.key} className={'agc' + (!st.enabled || pa ? ' off' : '')}>
                <div className="ct">
                  <span className="ic"><Ic n="ai" size={18} /></span>
                  <div>
                    <b>{a.name}</b>
                    <small>{a.does}</small>
                  </div>
                  <Switch
                    on={st.enabled && !pa}
                    disabled={pa || !admin || !data}
                    label={'Turn ' + a.name + (st.enabled ? ' off' : ' on')}
                    onClick={() => void change(a.key, { ...st, enabled: !st.enabled }, a.name + (st.enabled ? ' turned off' : ' turned on'))}
                  />
                </div>
                <div className="tg">
                  {admin ? (
                    <select
                      className="inp"
                      style={{ width: 'auto', height: 28, fontSize: 14, padding: '0 8px' }}
                      aria-label={'Permission level for ' + a.name}
                      value={st.level}
                      disabled={pa || !data}
                      onChange={(e) => void change(a.key, { ...st, level: e.target.value as Level }, a.name + ': ' + levelName(e.target.value as Level))}
                    >
                      {LEVELS.filter(([l]) => !(a.client && l === 'act')).map(([l, n]) => (
                        <option key={l} value={l}>
                          {n}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="tag ai">{levelName(st.level)}</span>
                  )}
                  <span className={'tag' + (a.client ? ' gold' : '')}>{a.client ? 'Client-visible only' : 'Team side'}</span>
                </div>
                <div className="rules">
                  <span>Never reads Team notes</span>
                  <span>Never approves</span>
                  <span>Shows sources</span>
                  <span>Posts via What reaches clients</span>
                </div>
                <div className="ft">
                  <span>{pa ? 'Paused' : !st.enabled ? 'Off' : RUNNING.includes(a.key) ? 'Running on Gemini (free, for testing)' : a.needs ? 'Needs ' + a.needs : 'Coming soon'}</span>
                  {a.key === 'away_assistant' && admin && (
                    <button type="button" className="btn sm" onClick={() => setTeaching(a.key)}>
                      <Ic n="edit" size={14} /> Teach
                    </button>
                  )}
                  <button type="button" className="btn sm" onClick={() => setLogOf(a.key)}>
                    Log
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <RuleBoxes />
      </div>
      {teaching && ws && <TeachDialog ws={ws} agent={teaching} onClose={() => setTeaching(null)} />}
      {logOf && (
        <>
          <div className="scrim" style={{ background: 'rgba(28,14,28,.3)' }} onClick={() => setLogOf(null)}></div>
          <aside className="drawer" role="dialog" aria-label="Agent log">
            <div className="ph">
              <div style={{ flex: 1 }}>
                <b>{logOf === 'all' ? 'All agents' : AGENTS.find((a) => a.key === logOf)?.name} · log</b>
                <small>Every action and change, with sources</small>
              </div>
              <button type="button" className="x" onClick={() => setLogOf(null)} aria-label="Close log">
                <Ic n="close" size={16} />
              </button>
            </div>
            <div className="pb">
              {!log ? (
                <p className="sub">Loading…</p>
              ) : !log.length ? (
                <div className="empty">Nothing yet. Changes to agents, and everything they do once running, are logged here.</div>
              ) : (
                <div className="log">
                  {log.map((e) => (
                    <div key={e.id}>
                      <small>
                        {new Date(e.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {logOf === 'all' ? ' · ' + (e.agent === 'all' ? 'All AI' : (AGENTS.find((a) => a.key === e.agent)?.name ?? e.agent)) : ''}
                      </small>
                      <b style={{ fontWeight: 600 }}>{e.action}</b>
                      {e.sources.length > 0 && <small>Sources: {e.sources.join(', ')}</small>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </Shell>
  );
}

function RuleBoxes() {
  return (
    <div className="rulebox">
      <div className="card">
        <div className="ct">
          <b>Hard rules</b>
          <span className="tag">Always on</span>
        </div>
        <ul>
          <li>Never reads Team notes when talking to a client</li>
          <li>Never approves, prices or promises dates</li>
          <li>Always shows its sources</li>
          <li>Posts to clients only through What reaches clients</li>
        </ul>
      </div>
      <div className="card">
        <div className="ct">
          <b>Permission levels</b>
        </div>
        {LEVELS.map(([k, a, b]) => (
          <div key={k} className="lv">
            <b>{a}</b>
            <span>{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoAgentsPage() {
  const { s, ui, update, setUI, toast } = useSeek();
  const pa = s.pauseAll;

  return (
    <Shell active="agents" side={<AppsSide active="agents" />}>
      <MainHeader
        title="AI agents"
        sub="Each agent follows the same hard rules, keeps a log, and can be switched off."
        right={
          backendOn ? undefined : (
            <button type="button" className="btn sm" onClick={() => setUI({ logOf: 'All agents' })}>
              Agent log
            </button>
          )
        }
      />
      <div className="pg">
        {backendOn ? (
          <>
            <div className="intro">
              <div>
                <h2>Your agents</h2>
                <p>Adding AI agents arrives in a later update.</p>
              </div>
              <span className="tag">Coming soon</span>
            </div>
            <div className="empty">No AI agents yet. Agents you add will show here, each with its own log and an off switch.</div>
          </>
        ) : (
        <>
        <div className="intro">
          <div>
            <h2>Your agents</h2>
            <p>
              {s.agents.filter((a) => a.on && !pa).length} of {s.agents.length} running
            </p>
          </div>
          <div className={'pause' + (pa ? ' on' : '')}>
            <div>
              <b>{pa ? 'All AI paused' : 'Pause all AI'}</b>
              <small>admins only</small>
            </div>
            <Switch
              on={pa}
              danger
              label="Pause all AI"
              onClick={() => {
                update((d) => {
                  d.pauseAll = !d.pauseAll;
                });
                toast(pa ? 'AI resumed' : 'All AI paused');
              }}
            />
          </div>
        </div>
        {pa && (
          <div className="banner gold" style={{ margin: 0 }}>
            <Ic n="pause" /> <span>All AI is paused for everyone. Agents keep their settings and resume when you turn this off.</span>
          </div>
        )}
        <div className="ag">
          {s.agents.map((a, i) => (
            <div key={a.n} className={'agc' + (!a.on || pa ? ' off' : '')}>
              <div className="ct">
                <span className="ic"><Ic n="ai" size={18} /></span>
                <div>
                  <b>{a.n}</b>
                  <small>{a.d}</small>
                </div>
                <Switch
                  on={a.on && !pa}
                  disabled={pa}
                  label={'Turn ' + a.n + (a.on ? ' off' : ' on')}
                  onClick={() => {
                    update((d) => {
                      d.agents[i].on = !d.agents[i].on;
                    });
                    toast(a.n + (a.on ? ' turned off' : ' turned on'));
                  }}
                />
              </div>
              <div className="tg">
                <span className="tag ai">{a.lv}</span>
                <span className={'tag' + (a.sc.startsWith('Client') ? ' gold' : '')}>{a.sc}</span>
              </div>
              <div className="rules">
                <span>Never reads Team notes</span>
                <span>Never approves</span>
                <span>Shows sources</span>
                <span>Posts via What reaches clients</span>
              </div>
              <div className="ft">
                <span>{pa ? 'Paused' : a.on ? a.st : 'Off'}</span>
                <button type="button" className="btn sm" onClick={() => setUI({ logOf: a.n })}>
                  Log
                </button>
              </div>
            </div>
          ))}
          <div className="agc later">
            <span className="tag">Later</span>
            <b style={{ fontSize: 15.5, color: 'var(--ink)' }}>Build your own agent</b>
            <small>Type, instructions, data, permissions, dry test.</small>
          </div>
        </div>
        </>
        )}
        <div className="rulebox">
          <div className="card">
            <div className="ct">
              <b>Hard rules</b>
              <span className="tag">Always on</span>
            </div>
            <ul>
              <li>Never reads Team notes when talking to a client</li>
              <li>Never approves, prices or promises dates</li>
              <li>Always shows its sources</li>
              <li>Posts to clients only through What reaches clients</li>
            </ul>
          </div>
          <div className="card">
            <div className="ct">
              <b>Permission levels</b>
            </div>
            {[
              ['Suggest only', 'Shows a suggestion; a person acts.'],
              ['Asks before acting', 'Prepares the action; a person approves.'],
              ['Acts', 'Acts on its own inside the rules, and logs it.'],
            ].map(([a, b]) => (
              <div key={a} className="lv">
                <b>{a}</b>
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {ui.logOf && !backendOn && (
        <>
          <div className="scrim" style={{ background: 'rgba(28,14,28,.3)' }} onClick={() => setUI({ logOf: null })}></div>
          <aside className="drawer" role="dialog" aria-label={ui.logOf + ' log'}>
            <div className="ph">
              <div style={{ flex: 1 }}>
                <b>{ui.logOf} · log</b>
                <small>Every action, with sources</small>
              </div>
              <button type="button" className="x" onClick={() => setUI({ logOf: null })} aria-label="Close log">
                <Ic n="close" size={16} />
              </button>
            </div>
            <div className="pb">
              <div className="log">
                {LOG.map(([t, a, b]) => (
                  <div key={t}>
                    <small>{t}</small>
                    <b style={{ fontWeight: 600 }}>{a}</b>
                    <small>{b}</small>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </>
      )}
    </Shell>
  );
}

export function AppsPage() {
  const { s, ui, update, setUI, toast } = useSeek();
  // with a backend, no apps can be connected yet, so the prototype's sample apps and requests never show
  const apps = backendOn ? [] : s.apps;
  const reqs = backendOn ? [] : s.reqs;
  const a = apps.find((x) => x.id === s.app);

  const pane =
    a && ui.paneOpen ? (
      <Pane
        title={a.n}
        sub={'Installed by ' + a.by}
        icon={
          <span className="lg" style={{ background: a.c, width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, color: '#fff', flex: 'none' }}>
            {a.id}
          </span>
        }
        onClose={() => setUI({ paneOpen: false })}
      >
        <div className="kv">
          <div>
            <span>Posts to</span>
            <b>{a.to}</b>
          </div>
          <div>
            <span>Tier</span>
            <b>
              <select
                className="tierSel"
                aria-label="Tier"
                value={a.tier}
                onChange={(e) => {
                  const v = e.target.value;
                  update((d) => {
                    d.apps.find((y) => y.id === a.id)!.tier = v;
                  });
                  toast(a.n + ' now posts on ' + v);
                }}
              >
                {['Digest', 'Normal', 'Urgent'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </b>
          </div>
          <div>
            <span>Access</span>
            <b>{a.acc}</b>
          </div>
          <div>
            <span>Status</span>
            <b className={a.on ? 'oktxt' : undefined} style={a.on ? undefined : { color: 'var(--sb)' }}>{a.on ? '● On' : 'Off'}</b>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--mu)' }}>Digest waits for the next summary. Normal notifies as usual. Urgent can break through Focus.</p>
        <button type="button" className="btn" onClick={() => toast('Test post sent to ' + a.to)}>
          Send test post
        </button>
        <button
          type="button"
          className={'btn ' + (a.on ? 'danger' : 'pri')}
          onClick={() => {
            update((d) => {
              const x = d.apps.find((y) => y.id === a.id)!;
              x.on = !x.on;
            });
            toast(a.n + (a.on ? ' turned off' : ' turned on'));
          }}
        >
          {a.on ? 'Turn off' : 'Turn on'}
        </button>
      </Pane>
    ) : undefined;

  const decide = (id: string, approve: boolean) => {
    const r = s.reqs.find((x) => x.id === id)!;
    update((d) => {
      d.reqs = d.reqs.filter((x) => x.id !== id);
      if (approve) {
        d.apps.push({ id: r.id, n: r.n, d: 'Newly installed', to: 'Team notes', tier: 'Digest', c: r.c, by: 'Ahsan · today', acc: 'Post messages', on: true });
        d.app = r.id;
      }
    });
    if (approve) setUI({ paneOpen: true });
    toast(r.n + (approve ? ' approved and installed on Digest' : ' request declined'));
  };

  return (
    <Shell active="apps" side={<AppsSide active="apps" />} pane={pane}>
      <MainHeader
        title="All apps"
        sub="Every connected tool, where it posts and on which tier. Apps never post to clients."
        right={
          <button type="button" className="btn sm pri" onClick={() => toast(backendOn ? 'Connecting apps arrives in a later update' : 'Opening the app directory')}>
            Browse directory
          </button>
        }
      />
      <div className="pg">
        {backendOn && (
          <>
            <div className="intro">
              <div>
                <h2>Connected apps</h2>
                <p>Connecting apps arrives in a later update.</p>
              </div>
              <span className="tag">Coming soon</span>
            </div>
            <div className="empty">No apps connected. Connect GitHub, Figma or your calendar. Their updates wait for the digest by default.</div>
          </>
        )}
        {!backendOn && <div className="stats">
          <div className="stat">
            <b>{s.apps.filter((x) => x.on).length}</b>
            <span>apps installed</span>
          </div>
          <div className="stat">
            <b>{s.apps.filter((x) => x.on && x.tier === 'Digest').length}</b>
            <span>post quietly on Digest</span>
          </div>
          <div className="stat ok">
            <b>0</b>
            <span>post to clients</span>
          </div>
          <div className="stat">
            <b>{s.reqs.length}</b>
            <span>requests to review</span>
          </div>
        </div>}
        {!backendOn && <div className="al">
          {apps.map((x) => (
            <button
              key={x.id}
              type="button"
              className={'ar' + (x.id === s.app ? ' on' : '') + (x.on ? '' : ' off')}
              aria-pressed={x.id === s.app}
              onClick={() => {
                update((d) => {
                  d.app = x.id;
                });
                setUI({ paneOpen: true });
              }}
            >
              <span className="lg" style={{ background: x.on ? x.c : '#c7bcc7' }}>
                {x.id}
              </span>
              <span className="x">
                <b>{x.n}</b>
                <small>{x.d}</small>
              </span>
              <span className="w">Posts to {x.to}</span>
              <span className={'tag' + (x.tier === 'Urgent' ? ' red' : x.tier === 'Normal' ? ' v' : '')}>{x.on ? x.tier : 'Off'}</span>
            </button>
          ))}
        </div>}
        <div className="banner v" style={{ margin: 0 }}>
          <Ic n="shield" size={14} />{' '}
          <span>
            Apps can't be given access to client spaces. Anything automatic that reaches a client is listed in <b>What reaches clients</b>.
          </span>
        </div>
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>
            Requests
          </div>
          <div className="al">
            {reqs.length ? (
              reqs.map((r) => (
                <div key={r.id} className="ar">
                  <span className="lg" style={{ background: r.c }}>
                    {r.id}
                  </span>
                  <span className="x">
                    <b>{r.n}</b>
                    <small>requested by {r.by}</small>
                  </span>
                  <button type="button" className="btn sm" onClick={() => decide(r.id, false)}>
                    Decline
                  </button>
                  <button type="button" className="btn sm pri" onClick={() => decide(r.id, true)}>
                    Approve
                  </button>
                </div>
              ))
            ) : (
              <div className="empty" style={{ padding: 16 }}>
                No requests to review.
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

/** Teach the assistant: how to reply (instructions) and what it can answer from (knowledge). Admins only. */
function TeachDialog({ ws, agent, onClose }: { ws: string; agent: AgentKey; onClose: () => void }) {
  const { toast } = useSeek();
  const [v, setV] = useState<{ instructions: string; knowledge: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadTraining(ws, agent).then(setV);
  }, [ws, agent]);
  const save = async () => {
    if (!v) return;
    setBusy(true);
    const err = await saveTraining(ws, agent, v.instructions.trim(), v.knowledge.trim());
    setBusy(false);
    toast(err ?? 'Saved. The assistant uses this from its next reply');
    if (!err) onClose();
  };
  return (
    <Modal
      title="Teach the assistant"
      icon={<Ic n="ai" />}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn pri" disabled={!v || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="mb">
        {!v ? (
          <p className="sub">Loading…</p>
        ) : (
          <>
            <div className="fld">
              <label htmlFor="t-ins">How it should reply</label>
              <textarea
                id="t-ins"
                className="inp"
                rows={4}
                maxLength={4000}
                placeholder={'e.g. Be friendly and brief. Our hours are Mon–Fri 9:00–18:00 (Lahore). For urgent issues tell people to email support@yourcompany.com.'}
                value={v.instructions}
                onChange={(e) => setV({ ...v, instructions: e.target.value })}
              />
            </div>
            <div className="fld">
              <label htmlFor="t-kn">What it knows</label>
              <textarea
                id="t-kn"
                className="inp"
                rows={9}
                maxLength={20000}
                placeholder={'Facts and answers it can give, e.g.\n- Homepage launch: Friday 11:00\n- Revisions: 2 rounds are included\n- Invoices are sent on the 1st of each month'}
                value={v.knowledge}
                onChange={(e) => setV({ ...v, knowledge: e.target.value })}
              />
              <em>{v.knowledge.length.toLocaleString()} / 20,000 characters. It only answers from this; anything else, it says the team will get back to them.</em>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
