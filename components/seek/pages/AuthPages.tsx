'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  acceptInviteLink,
  backendOn,
  createWorkspace,
  currentAccount,
  googleSignIn,
  myInvite,
  saveProfile,
  sendCode,
  sendInvite,
  verifyCode,
  type Account,
} from '@/lib/seek/backend';
import { initialsOf, isEmail, slugify } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { applyAccount, setMe, useSeek } from '@/lib/seek/store';
import { CodeInput, codeComplete } from '../CodeInput';
import { Avatar, Logo } from '../ui';

function Brand({ children }: { children?: React.ReactNode }) {
  return (
    <div className="brand">
      <i>S</i>
      <b>Seek</b>
      <small>by Convertt</small>
      {children}
    </div>
  );
}

export function SignupPage() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(s.email);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const typedCode = () => [...(formRef.current?.querySelectorAll<HTMLInputElement>('.codes input') ?? [])].map((x) => x.value).join('');

  const toSetup = () => {
    update((d) => {
      d.session = 'setup';
    });
    router.push(ROUTES.setup);
  };

  const cont = async () => {
    const v = email.trim();
    if (!isEmail(v)) {
      toast('Enter a valid work email');
      return;
    }
    if (backendOn) {
      setBusy(true);
      const err = await sendCode(v);
      setBusy(false);
      if (err) {
        toast(err);
        return;
      }
    }
    update((d) => {
      d.email = v;
      d.me.email = v;
    });
    setStep('code');
  };

  const verify = async () => {
    if (!codeComplete(formRef.current)) {
      toast('Enter all 6 digits');
      return;
    }
    if (!backendOn) {
      toast('Email verified ✓');
      toSetup();
      return;
    }
    if (busy) return;
    setBusy(true);
    const { error, account } = await verifyCode(s.email, typedCode());
    setBusy(false);
    if (error || !account) {
      toast(error || 'Couldn’t sign you in. Try again');
      return;
    }
    update((d) => applyAccount(d, account));
    toast('Email verified ✓');
    router.push(!account.onboarded ? ROUTES.welcome : account.workspace ? ROUTES.channels : ROUTES.setup);
  };

  const resend = async () => {
    if (!backendOn) {
      toast('New code sent');
      return;
    }
    const err = await sendCode(s.email);
    toast(err || 'New code sent');
  };

  const google = async () => {
    if (!backendOn) {
      toast('Signed in with Google');
      toSetup();
      return;
    }
    const err = await googleSignIn();
    if (err) toast(err);
  };

  return (
    <main className="auth">
      <div className="art">
        <Brand>
          <span className="tag" style={{ marginLeft: 'auto', background: 'rgba(255,255,255,.14)', color: '#fff' }}>
            Free trial · 14 days
          </span>
        </Brand>
        <h2>
          Set up Seek for <em>your agency.</em>
        </h2>
        <p>Messages, decisions and client work in one tidy workspace. Takes about two minutes.</p>
        <div className="prev">
          <div className="pc">
            <b># launch-squad</b>
            <div className="r">
              <Avatar k="SY" size={26} />
              <div>
                <b>Syed</b> <small style={{ color: 'var(--sb)' }}>10:04</small>
                <div>
                  Kickoff is live. <span style={{ color: 'var(--v)', fontWeight: 600 }}>@Ahsan</span> can you take the blocker?
                </div>
              </div>
            </div>
          </div>
          <div className="pc" style={{ marginLeft: 34, boxShadow: 'inset 3px 0 0 var(--ai),0 20px 40px -20px rgba(0,0,0,.5)' }}>
            <div className="r">
              <Avatar k="AI" size={26} />
              <div>
                <b>Standup Agent</b>
                <div style={{ color: 'var(--mu)' }}>Runs weekdays 09:30</div>
              </div>
            </div>
          </div>
          <div className="pc" style={{ boxShadow: 'inset 4px 0 0 var(--gold),0 20px 40px -20px rgba(0,0,0,.5)' }}>
            <span className="lbl" style={{ color: 'var(--gold)' }}>
              Decision
            </span>
            <b>Chris approved Hero option B</b>
            <small style={{ color: 'var(--sb)' }}>Saved as a decision · just now</small>
          </div>
        </div>
        <div className="checks">
          <span>Channels and huddles</span>
          <span>Client spaces</span>
          <span>Clients join free</span>
        </div>
      </div>
      <div className="fm" ref={formRef}>
        <div className="mbrand">
          <Logo />
        </div>
        <div className="top">
          Already have an account?{' '}
          <button type="button" className="linkbtn" onClick={() => toast('Sign in with your email code')}>
            Sign in
          </button>
        </div>
        <div className="in">
          {step === 'email' ? (
            <>
              <div>
                <h1>Create your account</h1>
              </div>
              <p className="sub">Free for 14 days. No card needed.</p>
              <button
                type="button"
                className="btn lg"
                onClick={google}
              >
                <b style={{ color: '#4285f4' }}>G</b> Continue with Google
              </button>
              <div className="or">OR</div>
              <form
                style={{ display: 'contents' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  cont();
                }}
              >
                <div className="fld">
                  <label htmlFor="em">Work email</label>
                  <input id="em" className="inp" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <button type="submit" className="btn lg pri" disabled={busy}>
                  {busy ? 'Sending code…' : 'Continue'}
                </button>
              </form>
              <div className="note">
                ✉ <span>We'll email you a 6-digit code. There is no password to remember.</span>
              </div>
              <p className="fine">
                By continuing, you agree to the <a href="#terms">Terms</a> and <a href="#privacy">Privacy policy</a>.
              </p>
            </>
          ) : (
            <>
              <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setStep('email')}>
                ← Change email
              </button>
              <div>
                <h1>Check your email</h1>
              </div>
              <p className="sub">
                Enter the 6-digit code we sent to <b>{s.email}</b>.{backendOn && ' Or open the sign-in link in that email on this device.'}
              </p>
              <CodeInput onComplete={verify} />
              <button type="button" className="btn lg pri" onClick={verify} disabled={busy}>
                {busy ? 'Checking…' : 'Verify and continue'}
              </button>
              <p className="fine">
                Didn't get it?{' '}
                <button type="button" className="linkbtn" onClick={resend}>
                  Resend code
                </button>
                {!backendOn && ' · Tip: any 6 digits work in this prototype'}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const ZONES = ['Lahore (GMT+5)', 'London (GMT+1)', 'Dubai (GMT+4)', 'New York (GMT-4)'];
const SIZES = ['1–10', '11–50', '51–200', '200+'];
const USES = ['Team chat', 'Client work', 'Tasks and decisions'];

export function SetupPage() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const [invite, setInvite] = useState('');
  const w = s.ws;
  const slug = slugify(w.name);
  const ws = (fn: (x: typeof w) => void) =>
    update((d) => {
      fn(d.ws);
    });

  const creates: [string, string][] = [
    ['general', 'everyone'],
    ['announcements', 'team news'],
    ['random', 'off-topic'],
  ];
  if (w.use.includes('Client work')) creates.push(['Clients', 'ready for your first client']);
  if (w.use.includes('Tasks and decisions')) creates.push(['Decisions', 'log and approvals']);

  const addInvite = () => {
    const v = invite.trim();
    if (!v) return;
    if (!isEmail(v)) {
      toast('Enter a valid email');
      return;
    }
    ws((x) => {
      if (!x.invites.includes(v)) x.invites.push(v);
    });
    setInvite('');
  };

  const [saving, setSaving] = useState(false);
  const finish = async () => {
    let failed = 0;
    if (backendOn) {
      if (saving) return;
      setSaving(true);
      const { error: err, id } = await createWorkspace({ ...w, slug });
      if (err || !id) {
        setSaving(false);
        toast(err || 'Couldn’t create the workspace. Try again');
        return;
      }
      // each teammate gets an invite email whose Join button brings them straight into this workspace
      for (const email of w.invites) if (!(await sendInvite(id, email)).ok) failed++;
      setSaving(false);
    }
    update((d) => {
      d.session = 'in';
      d.workspaces.C.ch = 'general';
    });
    toast(
      failed
        ? `Workspace ready. ${failed} invite email${failed === 1 ? '' : 's'} couldn’t be sent; invite again from the channel list`
        : `Workspace ${w.name || 'Convertt'} is ready · ${w.invites.length} invites sent`,
    );
    router.push(ROUTES.channels);
  };

  return (
    <main className="auth">
      <div className="art">
        <Brand />
        <h2>
          Set up for how <em>your team works.</em>
        </h2>
        <p>Your answers decide which channels and spaces we create, and your notification defaults.</p>
        <div className="pc" style={{ maxWidth: 420 }}>
          <div className="r">
            <span className="av" style={{ width: 34, height: 34, background: 'var(--v)', fontSize: 14, borderRadius: 10 }}>
              {(w.name || 'S')[0].toUpperCase()}
            </span>
            <div>
              <b>{w.name || 'Workspace'}</b>
              <div style={{ color: 'var(--sb)', fontSize: 12 }} className="mono">
                {slug}.seek.app
              </div>
            </div>
          </div>
        </div>
        <div>
          <div className="lbl" style={{ color: '#c6a7c6', marginBottom: 8 }}>
            We'll create
          </div>
          <div className="creates">
            {creates.map(([a, b]) => (
              <div key={a}>
                {a === 'Clients' || a === 'Decisions' ? '◆' : '#'} {a}
                <small>{b}</small>
              </div>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 13 }}>
          Notifications start on <b style={{ color: '#fff' }}>Balanced</b>.
        </p>
      </div>
      <div className="fm">
        <div className="mbrand">
          <Logo />
        </div>
        <div className="top">Signed in as {s.email}</div>
        <div className="in">
          <div className="steps">
            <span className="d">
              <i>✓</i>Account
            </span>
            <hr />
            <span className="d">
              <i>✓</i>Profile
            </span>
            <hr />
            <span className="c">
              <i>3</i>Workspace
            </span>
          </div>
          <div>
            <h1>Set up your workspace</h1>
          </div>
          <p className="sub">A few questions so it is set up for how your team works.</p>
          <div className="grid2">
            <div className="fld">
              <label htmlFor="wsn">Workspace name</label>
              <input
                className="inp"
                id="wsn"
                value={w.name}
                onChange={(e) =>
                  ws((x) => {
                    x.name = e.target.value;
                  })
                }
              />
              <em className="mono">{slug}.seek.app</em>
            </div>
            <div className="fld">
              <label htmlFor="wtz">Time zone</label>
              <select
                id="wtz"
                className="inp"
                value={w.tz}
                onChange={(e) =>
                  ws((x) => {
                    x.tz = e.target.value;
                  })
                }
              >
                {ZONES.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
              <em>For working hours and Focus.</em>
            </div>
          </div>
          <div className="fld">
            <label>Team size</label>
            <div className="chips">
              {SIZES.map((z) => (
                <button
                  key={z}
                  type="button"
                  aria-pressed={w.size === z}
                  className={'chip' + (w.size === z ? ' on' : '')}
                  onClick={() =>
                    ws((x) => {
                      x.size = z;
                    })
                  }
                >
                  {z}
                </button>
              ))}
            </div>
          </div>
          <div className="fld">
            <label>How will you use Seek?</label>
            <div className="chips">
              {USES.map((u) => {
                const on = w.use.includes(u);
                return (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={on}
                    className={'chip' + (on ? ' on' : '')}
                    onClick={() =>
                      ws((x) => {
                        x.use = on ? x.use.filter((y) => y !== u) : [...x.use, u];
                      })
                    }
                  >
                    {on ? '✓ ' : ''}
                    {u}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="fld">
            <label htmlFor="invIn">
              Invite teammates <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(optional)</span>
            </label>
            <div className="tagin">
              {w.invites.map((e, i) => (
                <span key={e}>
                  {e}
                  <button
                    type="button"
                    aria-label={'Remove ' + e}
                    onClick={() =>
                      ws((x) => {
                        x.invites.splice(i, 1);
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                id="invIn"
                type="email"
                placeholder="Add email, press Enter"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addInvite();
                  }
                }}
                onBlur={() => invite.trim() && isEmail(invite.trim()) && addInvite()}
              />
            </div>
          </div>
          <button type="button" className="btn lg pri" onClick={finish} disabled={saving}>
            {saving ? 'Creating workspace…' : 'Continue to #general'}
          </button>
          <p className="fine">🔒 Secure sign-in · Your data is encrypted</p>
        </div>
      </div>
    </main>
  );
}

/**
 * Welcome: where invite emails land (their Join button) and where everyone sets up their profile once, after
 * their first sign-in. Invited people then go straight into their team's #general; people who signed up on
 * their own go on to set up a workspace.
 */
export function WelcomePage() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const [phase, setPhase] = useState<'loading' | 'join' | 'code' | 'profile'>('loading');
  const [invite, setInvite] = useState<{ workspace: string; invitedBy: string } | null>(null);
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [tz, setTz] = useState(ZONES[0]);
  const [busy, setBusy] = useState(false);
  const token = useRef<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  /** Signed in: set up the profile, or carry on if that's already done. */
  const toProfile = async (acc: Account) => {
    if (acc.onboarded) {
      router.replace(acc.workspace ? ROUTES.channels : ROUTES.setup);
      return;
    }
    setHasWorkspace(!!acc.workspace);
    setInvite(acc.workspace ? await myInvite().catch(() => null) : null);
    setEmail(acc.email);
    setName(acc.name);
    setTitle(acc.title);
    setTz(ZONES.includes(acc.timeZone) ? acc.timeZone : ZONES[0]);
    setPhase('profile');
  };

  const started = useRef(false);
  useEffect(() => {
    // once only: the first run takes the one-time link out of the address bar
    if (started.current) return;
    started.current = true;
    (async () => {
      if (!backendOn) {
        setName(s.me.name);
        setTitle(s.me.title);
        setPhase('profile');
        return;
      }
      const q = new URLSearchParams(location.search);
      setEmail(q.get('email') ?? '');
      const th = q.get('token_hash');
      if (th) {
        // keep the one-time link out of the address bar and history
        token.current = th;
        history.replaceState(null, '', location.pathname);
        setPhase('join');
        return;
      }
      const acc = await currentAccount().catch(() => null);
      if (!acc) router.replace(ROUTES.signup);
      else await toProfile(acc);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signedIn = async (acc: Account) => {
    update((d) => applyAccount(d, acc));
    await toProfile(acc);
  };

  const join = async () => {
    if (busy || !token.current) return;
    setBusy(true);
    const { error, account } = await acceptInviteLink(token.current);
    if (!error && account) {
      setBusy(false);
      await signedIn(account);
      return;
    }
    // the link was already used or has expired: fall back to a fresh code
    if (isEmail(email)) {
      const err = await sendCode(email);
      setBusy(false);
      if (!err) {
        setPhase('code');
        toast('That link has expired, so we emailed you a new 6-digit code');
        return;
      }
      toast(err);
      return;
    }
    setBusy(false);
    toast('That invite link has expired. Sign in with your email instead');
    router.replace(ROUTES.signup);
  };

  const verify = async () => {
    const code = [...(formRef.current?.querySelectorAll<HTMLInputElement>('.codes input') ?? [])].map((x) => x.value).join('');
    if (code.length < 6) {
      toast('Enter all 6 digits');
      return;
    }
    if (busy) return;
    setBusy(true);
    const { error, account } = await verifyCode(email, code);
    setBusy(false);
    if (error || !account) {
      toast(error || 'Couldn’t sign you in. Try again');
      return;
    }
    await signedIn(account);
  };

  const finish = async () => {
    const n = name.trim();
    if (!n) {
      toast('Enter your name');
      return;
    }
    if (busy) return;
    if (!backendOn) {
      setMe(n);
      update((d) => {
        d.me = { ...d.me, name: n, title: title.trim(), tz };
      });
      toast('Profile saved');
      router.push(ROUTES.channels);
      return;
    }
    setBusy(true);
    const err = await saveProfile({ name: n, title: title.trim(), timeZone: tz });
    const acc = err ? null : await currentAccount();
    setBusy(false);
    if (err || !acc) {
      toast(err || 'Couldn’t save your profile. Try again');
      return;
    }
    update((d) => {
      applyAccount(d, acc);
      if (acc.workspace) d.workspaces.C.ch = 'general';
    });
    toast(invite ? `Welcome to ${invite.workspace} 👋` : 'Profile saved');
    router.push(acc.workspace ? ROUTES.channels : ROUTES.setup);
  };

  const shown = name.trim() || 'Your name';
  const ws = invite?.workspace;

  return (
    <main className="auth">
      <div className="art">
        <Brand />
        <h2>
          {ws ? (
            <>
              Welcome to <em>{ws}.</em>
            </>
          ) : (
            <>
              Welcome to <em>Seek.</em>
            </>
          )}
        </h2>
        <p>
          {invite
            ? `${invite.invitedBy} invited you. Tell the team who you are, then you're in.`
            : phase === 'join'
              ? 'Your team invited you to Seek: messages, decisions and client work in one tidy workspace.'
              : 'Tell your team who you are. You can change this any time from your profile.'}
        </p>
        {phase === 'profile' && (
          <div className="pc" style={{ maxWidth: 420 }}>
            <div className="r">
              <span className="av" style={{ width: 40, height: 40, background: 'var(--v)', fontSize: 15, borderRadius: 12 }}>
                {initialsOf(shown)}
              </span>
              <div>
                <b>{shown}</b>
                <div style={{ color: 'var(--sb)', fontSize: 12 }}>{[title.trim() || 'Your role', tz].join(' · ')}</div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="fm" ref={formRef}>
        <div className="mbrand">
          <Logo />
        </div>
        {email && phase !== 'join' && <div className="top">Signed in as {email}</div>}
        <div className="in">
          {phase === 'loading' && <p className="sub">Loading…</p>}

          {phase === 'join' && (
            <>
              <div>
                <h1>You're invited</h1>
              </div>
              <p className="sub">
                Join your team on Seek{email ? (
                  <>
                    {' '}
                    as <b>{email}</b>
                  </>
                ) : null}
                . No password needed.
              </p>
              <button type="button" className="btn lg pri" onClick={join} disabled={busy}>
                {busy ? 'Joining…' : 'Join now'}
              </button>
              <p className="fine">Next, you'll set up your profile.</p>
            </>
          )}

          {phase === 'code' && (
            <>
              <div>
                <h1>Check your email</h1>
              </div>
              <p className="sub">
                Enter the 6-digit code we sent to <b>{email}</b>.
              </p>
              <CodeInput onComplete={verify} />
              <button type="button" className="btn lg pri" onClick={verify} disabled={busy}>
                {busy ? 'Checking…' : 'Verify and continue'}
              </button>
              <p className="fine">
                Didn't get it?{' '}
                <button type="button" className="linkbtn" onClick={async () => toast((await sendCode(email)) || 'New code sent')}>
                  Resend code
                </button>
              </p>
            </>
          )}

          {phase === 'profile' && (
            <>
              <div className="steps">
                <span className="d">
                  <i>✓</i>
                  {invite ? 'Invite' : 'Account'}
                </span>
                <hr />
                <span className="c">
                  <i>2</i>Profile
                </span>
                {!hasWorkspace && (
                  <>
                    <hr />
                    <span>
                      <i>3</i>Workspace
                    </span>
                  </>
                )}
              </div>
              <div>
                <h1>Set up your profile</h1>
              </div>
              <p className="sub">{invite ? `This is how you'll appear to ${invite.invitedBy} and the rest of ${invite.workspace}.` : 'This is how you’ll appear to your team.'}</p>
              <form
                style={{ display: 'contents' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void finish();
                }}
              >
                <div className="fld">
                  <label htmlFor="pn">Full name</label>
                  <input id="pn" className="inp" autoComplete="name" placeholder="e.g. Momna Khan" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                </div>
                <div className="grid2">
                  <div className="fld">
                    <label htmlFor="pt">
                      What you do <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <input id="pt" className="inp" autoComplete="organization-title" placeholder="e.g. Designer" value={title} onChange={(e) => setTitle(e.target.value)} />
                  </div>
                  <div className="fld">
                    <label htmlFor="ptz">Time zone</label>
                    <select id="ptz" className="inp" value={tz} onChange={(e) => setTz(e.target.value)}>
                      {ZONES.map((z) => (
                        <option key={z}>{z}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button type="submit" className="btn lg pri" disabled={busy}>
                  {busy ? 'Saving…' : hasWorkspace ? `Continue to ${ws ?? 'your workspace'}` : 'Continue'}
                </button>
              </form>
              <p className="fine">🔒 Only people in your workspace can see your profile.</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
