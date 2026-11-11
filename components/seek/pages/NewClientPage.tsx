'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClientSpace, currentAccount, inviteClient, sb, type ClientRole } from '@/lib/seek/backend';
import { PEOPLE, type PersonKey } from '@/lib/seek/data';
import { isEmail } from '@/lib/seek/format';
import { keyFor, learnProfiles } from '@/lib/seek/live';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Avatar } from '../ui';

/**
 * New client space, in four steps (as in the product guide): who the client is, their onboarding checklist, the
 * rules (reply target, tone, words never to mention), then review and invite. Nothing is created or sent until
 * "Create space and send invites".
 */

type Person = { name: string; email: string; role: ClientRole };
type StepPick = { kind: string; title: string; detail: string; side: 'client' | 'team'; on: boolean; fixed?: boolean };

const COLORS = ['#8a5300', '#684068', '#5c7c2b', '#7a4b8c', '#1f6b8a', '#b0306a'];
const REPLY = ['4 working hours', '1 working day', '2 working days'];
const ROLES: [ClientRole, string][] = [
  ['approver', 'Approver'],
  ['contributor', 'Contributor'],
  ['viewer', 'Viewer'],
];
const STEPS: StepPick[] = [
  { kind: 'profile', title: 'Set up their profile', detail: 'name and notification email', side: 'client', on: true, fixed: true },
  { kind: 'assets', title: 'Upload brand assets', detail: 'logos, fonts, guidelines', side: 'client', on: true },
  { kind: 'approvers', title: 'Confirm who approves', detail: 'design, copy, launch', side: 'client', on: true },
  { kind: 'kickoff', title: 'Book the kickoff call', detail: 'a 30-minute call this week', side: 'client', on: true },
  { kind: 'scope', title: 'Review and accept the scope', detail: 'reads the scope, presses Accept', side: 'client', on: true },
  { kind: 'logins', title: 'Share website logins', detail: 'hosting and CMS access', side: 'client', on: false },
  { kind: 'kickoff-held', title: 'Hold the kickoff call', detail: 'log decisions from the call', side: 'team', on: true },
  { kind: 'rhythm', title: 'Set the working rhythm', detail: 'update day and reply target', side: 'team', on: true },
];
const WIZ = ['Who is the client', 'Client onboarding', 'Rules', 'Review and invite'];
const SUBS = ['people and roles', 'what they do in the app', 'reply target and tone', 'send the invites'];

const codeOf = (name: string) =>
  name
    .split(/[\s&]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase() || 'C';
const first = (p: Person) => (p.name.trim() || p.email.split('@')[0]).split(' ')[0];
const joinNames = (n: string[]) => (n.length <= 1 ? n[0] ?? '' : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]);

export function NewClientPage() {
  const { s, ui, toast, update, setUI } = useSeek();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [teammates, setTeammates] = useState<string[]>([]);

  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [code, setCode] = useState('');
  const [people, setPeople] = useState<Person[]>([{ name: '', email: '', role: 'approver' }]);
  const [team, setTeam] = useState<string[]>([]);
  const [steps, setSteps] = useState<StepPick[]>(STEPS);
  const [custom, setCustom] = useState('');
  const [reply, setReply] = useState(REPLY[1]);
  const [tone, setTone] = useState('Warm, short, no agency jargon');
  const [never, setNever] = useState<string[]>([]);
  const [word, setWord] = useState('');
  const [welcome, setWelcome] = useState('');
  const [busy, setBusy] = useState(false);

  // your organization and its team, to pick who works on this client
  useEffect(() => {
    void (async () => {
      const acc = await currentAccount();
      if (!acc?.workspace) return;
      setOrgId(acc.workspace.id);
      setMe(acc.id);
      const { data } = await sb().from('workspace_members').select('user_id, role').eq('workspace_id', acc.workspace.id);
      const ids = ((data ?? []) as { user_id: string; role: string }[]).filter((m) => m.role !== 'guest' && m.user_id !== acc.id).map((m) => m.user_id);
      await learnProfiles(ids, acc.id);
      setTeammates(ids);
    })();
  }, []);

  const shownCode = (code || codeOf(name)).slice(0, 3);
  const valid = people.filter((p) => isEmail(p.email.trim()));
  const clientNames = joinNames(valid.map(first));
  const agency = s.ws.name || 'your agency';
  const chosen = steps.filter((x) => x.on);
  const welcomeText = welcome || `Hi ${clientNames || 'there'}, welcome to your project space! Everything for ${project.trim() || 'the project'} lives here. Start with the short checklist on the left.`;

  const setPerson = (i: number, patch: Partial<Person>) => setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const check = (n: number): string | null => {
    if (n === 0) {
      if (!name.trim()) return 'Enter the client’s name';
      if (!valid.length) return 'Add at least one person at the client, with their email';
      if (people.some((p) => p.email.trim() && !isEmail(p.email.trim()))) return 'One of the client emails isn’t valid';
    }
    return null;
  };
  const go = (n: number) => {
    for (let i = 0; i < n; i++) {
      const err = check(i);
      if (err) {
        setStep(i);
        toast(err);
        return;
      }
    }
    setStep(n);
    setUI({ sideOpen: false });
  };

  const create = async () => {
    const err = check(0);
    if (err) {
      setStep(0);
      toast(err);
      return;
    }
    if (!orgId || busy) return;
    setBusy(true);
    const { error, id } = await createClientSpace({
      orgId,
      name: name.trim(),
      project: project.trim(),
      code: shownCode,
      color,
      replyTarget: reply,
      tone: tone.trim(),
      neverMention: never,
      people: valid.map((p) => ({ email: p.email.trim().toLowerCase(), name: p.name.trim(), role: p.role })),
      team,
      steps: chosen.map(({ kind, title, detail, side }) => ({ kind, title, detail, side })),
      welcome: welcomeText,
    });
    if (error || !id) {
      setBusy(false);
      toast(error || 'Couldn’t create the client space. Try again');
      return;
    }
    let failed = 0;
    for (const p of valid) if (!(await inviteClient(id, p.email.trim().toLowerCase())).ok) failed++;
    setBusy(false);
    update((d) => {
      d.cs = id;
      d.cTab = 'Client chat';
    });
    toast(failed ? `${name.trim()} is ready. ${failed} invite${failed === 1 ? '' : 's'} couldn’t be sent; resend from People` : `${name.trim()} is ready · invites sent to ${clientNames}`);
    router.push(ROUTES.clients);
  };

  const side = (
    <Sidebar title="New client space" sub={name.trim() ? `${name.trim()}${project.trim() ? ' · ' + project.trim() : ''}` : 'Nothing is sent until the last step'}>
      <div className="sg lbl">Steps</div>
      {WIZ.map((t, i) => (
        <button key={t} type="button" className={'si' + (step === i ? ' on' : '')} aria-current={step === i ? 'step' : undefined} onClick={() => go(i)}>
          <span className="av" style={{ width: 26, height: 26, borderRadius: 13, background: i < step ? 'var(--v)' : step === i ? 'var(--gold)' : 'var(--ln2)', fontSize: 11 }}>
            {i < step ? '✓' : i + 1}
          </span>
          <span className="x">
            <b>{t}</b>
            <small>{SUBS[i]}</small>
          </span>
        </button>
      ))}
      <button type="button" className="si" onClick={() => router.push(ROUTES.clients)}>
        ✕ Cancel
      </button>
    </Sidebar>
  );

  const preview = (
    <Pane title="Preview" sub="what the client space will look like" onClose={() => setUI({ paneOpen: false })}>
      <div className="joinorg">
        <span className="av" style={{ width: 40, height: 40, borderRadius: 11, background: color, fontSize: 14 }}>
          {shownCode}
        </span>
        <div>
          <b>{name.trim() || 'Client name'}</b>
          <small>{project.trim() || 'Project'}</small>
        </div>
      </div>
      <div className="ppl">
        {valid.map((p) => (
          <div key={p.email}>
            <span className="av" style={{ width: 30, height: 30, background: 'var(--golds)', color: 'var(--gold)', fontSize: 11 }}>
              {first(p)[0]?.toUpperCase()}
            </span>
            <span>
              <b>{p.name.trim() || p.email}</b>
              <small>client · {p.role}</small>
            </span>
          </div>
        ))}
        {(['AH', ...team.map((t) => keyFor(t, me))] as PersonKey[]).map((k, i) => (
          <div key={k}>
            <Avatar k={k} size={30} />
            <span>
              <b>{PEOPLE[k]?.name ?? 'Teammate'}</b>
              <small>team{i === 0 ? ' · lead' : ''}</small>
            </span>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="ct">
          <b>{clientNames ? `${clientNames.split(' and ')[0]}’s checklist` : 'Client checklist'}</b>
          <span className="tag gold">{`${chosen.filter((x) => x.side === 'client').length} steps`}</span>
        </div>
        {chosen
          .filter((x) => x.side === 'client')
          .map((x) => (
            <small key={x.kind} style={{ color: 'var(--mu)' }}>
              ○ {x.title}
            </small>
          ))}
      </div>
      <div className="timer">
        <b>“The {agency} team replies within {reply}.”</b>The client sees this line in their space.
      </div>
    </Pane>
  );

  let body: React.ReactNode;
  if (step === 0) {
    body = (
      <>
        <div className="grid2">
          <div className="fld">
            <label htmlFor="ncn">Client name</label>
            <input id="ncn" className="inp" placeholder="e.g. Hollow & Bright" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="fld">
            <label htmlFor="ncp">Project</label>
            <input id="ncp" className="inp" placeholder="e.g. Website relaunch" value={project} onChange={(e) => setProject(e.target.value)} />
          </div>
        </div>
        <div className="fld">
          <label>Colour and short code</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={'Colour ' + c} aria-pressed={color === c} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: 0, boxShadow: color === c ? '0 0 0 2px #fff, 0 0 0 4px ' + c : 'none', cursor: 'pointer' }} />
            ))}
            <input className="inp mono" aria-label="Short code" style={{ width: 70, textTransform: 'uppercase' }} maxLength={3} value={code} placeholder={codeOf(name)} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
          </div>
        </div>
        <div className="fld">
          <label>
            People at the client <span style={{ color: 'var(--sb)', fontWeight: 400 }}>they join with an email code</span>
          </label>
          {people.map((p, i) => (
            <div key={i} className="copyrow" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
              <input className="inp" placeholder="Name" aria-label="Name" value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} style={{ flex: '1 1 120px', fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)' }} />
              <input className="inp" type="email" placeholder="name@client.com" aria-label="Email" value={p.email} onChange={(e) => setPerson(i, { email: e.target.value })} style={{ flex: '2 1 180px', fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)' }} />
              <select className="inp" style={{ width: 'auto' }} aria-label="Role" value={p.role} onChange={(e) => setPerson(i, { role: e.target.value as ClientRole })}>
                {ROLES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              {people.length > 1 && (
                <button type="button" className="btn sm ghost" aria-label="Remove person" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))}>
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPeople((ps) => [...ps, { name: '', email: '', role: 'contributor' }])}>
            ＋ Add client person
          </button>
          <em>Approvers can formally approve, contributors can write and upload, viewers can only read.</em>
        </div>
        <div className="fld">
          <label>Your team on this client</label>
          <div className="chips">
            <span className="chip on">✓ You · lead</span>
            {teammates.map((t) => {
              const on = team.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on} className={'chip' + (on ? ' on' : '')} onClick={() => setTeam((xs) => (on ? xs.filter((y) => y !== t) : [...xs, t]))}>
                  {on ? '✓ ' : ''}
                  {PEOPLE[t]?.name ?? 'Teammate'}
                </button>
              );
            })}
          </div>
          {!teammates.length && <em>Nobody else is in your organization yet. You can add teammates to this client later.</em>}
        </div>
      </>
    );
  } else if (step === 1) {
    body = (
      <>
        <p className="sub" style={{ margin: 0 }}>
          These steps appear as a checklist in the client’s space. You see their progress in Status.
        </p>
        {(['client', 'team'] as const).map((sd) => (
          <div key={sd} className="card">
            <div className="ct">
              <b>{sd === 'client' ? 'Client steps' : 'Your team’s steps'}</b>
              <span className={'tag' + (sd === 'client' ? ' gold' : '')}>{sd === 'client' ? 'the client sees these' : 'team only'}</span>
            </div>
            {steps
              .map((x, i) => [x, i] as const)
              .filter(([x]) => x.side === sd)
              .map(([x, i]) => (
                <label key={x.kind + i} className="trow" style={{ cursor: x.fixed ? 'default' : 'pointer' }}>
                  <div>
                    <b>{x.title}</b>
                    <small>{x.detail}</small>
                  </div>
                  <input type="checkbox" checked={x.on} disabled={x.fixed} onChange={() => setSteps((xs) => xs.map((y, j) => (j === i ? { ...y, on: !y.on } : y)))} aria-label={x.title} />
                </label>
              ))}
          </div>
        ))}
        <form
          className="copyrow"
          onSubmit={(e) => {
            e.preventDefault();
            const t = custom.trim();
            if (!t) return;
            setSteps((xs) => [...xs, { kind: 'custom', title: t.slice(0, 120), detail: 'custom step', side: 'client', on: true }]);
            setCustom('');
          }}
        >
          <input className="inp" placeholder="Add a custom client step" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)' }} />
          <button type="submit" className="btn">
            ＋ Add
          </button>
        </form>
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <div className="fld">
          <label>Reply target</label>
          <div className="chips">
            {REPLY.map((r) => (
              <button key={r} type="button" aria-pressed={reply === r} className={'chip' + (reply === r ? ' on' : '')} onClick={() => setReply(r)}>
                {r}
              </button>
            ))}
          </div>
          <em>Shown to the client in their space. Counts working hours only.</em>
        </div>
        <div className="fld">
          <label htmlFor="nct">Tone for client messages</label>
          <input id="nct" className="inp" value={tone} onChange={(e) => setTone(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="ncw">
            Never mention <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(team only, never shown to the client)</span>
          </label>
          <div className="tagin">
            {never.map((w, i) => (
              <span key={w}>
                {w}
                <button type="button" aria-label={'Remove ' + w} onClick={() => setNever((xs) => xs.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
            <input
              id="ncw"
              placeholder="Add word, press Enter"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',') && word.trim()) {
                  e.preventDefault();
                  if (!never.includes(word.trim())) setNever((xs) => [...xs, word.trim()]);
                  setWord('');
                }
              }}
            />
          </div>
        </div>
      </>
    );
  } else {
    const rows: [string, string][] = [
      ['Client', `${name.trim() || '—'}${project.trim() ? ' · ' + project.trim() : ''}`],
      ['People', valid.map((p) => `${p.name.trim() || p.email} (${p.role})`).join(', ') || '—'],
      ['Your team', ['You (lead)', ...team.map((t) => PEOPLE[t]?.name ?? 'Teammate')].join(', ')],
      ['Onboarding', `${chosen.filter((x) => x.side === 'client').length} client steps · ${chosen.filter((x) => x.side === 'team').length} team steps`],
      ['Reply target', reply],
      ['Spaces created', 'Client chat · Team notes · Status · Approvals · People'],
    ];
    body = (
      <>
        <div className="card">
          <div className="kv">
            {rows.map(([a, b]) => (
              <div key={a}>
                <span>{a}</span>
                <b>{b}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="fld">
          <label htmlFor="ncwm">Welcome message · the first message in Client chat</label>
          <textarea id="ncwm" className="inp" rows={3} value={welcomeText} onChange={(e) => setWelcome(e.target.value)} />
        </div>
        <div className="card">
          <div className="ct">
            <b>The invite email</b>
            <span className="tag">to {valid.map((p) => p.email.trim()).join(', ') || '—'}</span>
          </div>
          <b style={{ fontSize: 16 }}>Join {name.trim() || 'your'}’s project space</b>
          <small style={{ color: 'var(--mu)' }}>
            Chat with the {agency} team, complete onboarding and approve work, all in one place. One Join button, no password: they get a sign-in code.
          </small>
        </div>
      </>
    );
  }

  return (
    <Shell active="clients" side={side} pane={ui.paneOpen ? preview : undefined}>
      <MainHeader title={`Step ${step + 1} of 4 · ${WIZ[step]}`} sub="Nothing is sent until you press Create space and send invites" />
      <div className="pg" style={{ maxWidth: 760 }}>
        {body}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
          <button type="button" className="btn" onClick={() => (step ? go(step - 1) : router.push(ROUTES.clients))}>
            {step ? '← Back' : 'Cancel'}
          </button>
          {step < 3 ? (
            <button type="button" className="btn pri" onClick={() => go(step + 1)}>
              Next: {WIZ[step + 1].toLowerCase()} →
            </button>
          ) : (
            <button type="button" className="btn pri" onClick={create} disabled={busy || !orgId}>
              {busy ? 'Creating and inviting…' : 'Create space and send invites'}
            </button>
          )}
        </div>
      </div>
    </Shell>
  );
}
