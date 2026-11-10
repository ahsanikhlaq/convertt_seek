'use client';

import Link from 'next/link';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Switch } from '../ui';

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
  const { s, ui, update, setUI, toast } = useSeek();
  const pa = s.pauseAll;

  return (
    <Shell active="agents" side={<AppsSide active="agents" />}>
      <MainHeader
        title="AI agents"
        sub="Each agent follows the same hard rules, keeps a log, and can be switched off."
        right={
          <button type="button" className="btn sm" onClick={() => setUI({ logOf: 'All agents' })}>
            Agent log
          </button>
        }
      />
      <div className="pg">
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
            ⏸ <span>All AI is paused for everyone. Agents keep their settings and resume when you turn this off.</span>
          </div>
        )}
        <div className="ag">
          {s.agents.map((a, i) => (
            <div key={a.n} className={'agc' + (!a.on || pa ? ' off' : '')}>
              <div className="ct">
                <span className="ic">✦</span>
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
            <b style={{ fontSize: 14.5, color: 'var(--ink)' }}>Build your own agent</b>
            <small>Type, instructions, data, permissions, dry test.</small>
          </div>
        </div>
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
      {ui.logOf && (
        <>
          <div className="scrim" style={{ background: 'rgba(28,14,28,.3)' }} onClick={() => setUI({ logOf: null })}></div>
          <aside className="drawer" role="dialog" aria-label={ui.logOf + ' log'}>
            <div className="ph">
              <div style={{ flex: 1 }}>
                <b>{ui.logOf} · log</b>
                <small>Every action, with sources</small>
              </div>
              <button type="button" className="x" onClick={() => setUI({ logOf: null })} aria-label="Close log">
                ×
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
  const a = s.apps.find((x) => x.id === s.app);

  const pane =
    a && ui.paneOpen ? (
      <Pane
        title={a.n}
        sub={'Installed by ' + a.by}
        icon={
          <span className="lg" style={{ background: a.c, width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12, color: '#fff', flex: 'none' }}>
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
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mu)' }}>Digest waits for the next summary. Normal notifies as usual. Urgent can break through Focus.</p>
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
          <button type="button" className="btn sm pri" onClick={() => toast('Opening the app directory')}>
            Browse directory
          </button>
        }
      />
      <div className="pg">
        <div className="stats">
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
        </div>
        <div className="al">
          {s.apps.map((x) => (
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
        </div>
        <div className="banner v" style={{ margin: 0 }}>
          🛡{' '}
          <span>
            Apps can't be given access to client spaces. Anything automatic that reaches a client is listed in <b>What reaches clients</b>.
          </span>
        </div>
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>
            Requests
          </div>
          <div className="al">
            {s.reqs.length ? (
              s.reqs.map((r) => (
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
