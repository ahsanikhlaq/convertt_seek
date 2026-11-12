'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  acceptInviteLink,
  backendOn,
  companyDomain,
  createOrganisation,
  currentAccount,
  googleSignIn,
  joinByCode,
  joinByDomain,
  joinableOrgs,
  preferOrg,
  joinInfo,
  myInvite,
  saveProfile,
  sendCode,
  sendInvite,
  setDomainJoin,
  slugAvailable,
  uploadLogo,
  verifyCode,
  waitSeconds,
  type Account,
} from '@/lib/seek/backend';
import { initialsOf, isEmail, slugify } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { applyAccount, setMe, useSeek } from '@/lib/seek/store';
import { CodeInput, codeComplete } from '../CodeInput';
import { InviteLink } from '../InviteDialog';
import { Avatar, Logo, OrgMark } from '../ui';
import { THEMES } from '@/lib/seek/data';

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

/** Supabase: Authentication → Rate Limits → "Minimum interval per user" (seconds between emails to one person). */
const RESEND_AFTER = 15;

/** Where a signed-in person with a profile belongs: their team, their client space, or organization setup. */
const homeOf = (a: Account) => (a.workspace ? ROUTES.channels : a.clientSpaces.length ? ROUTES.clients : ROUTES.setup);

/** Seconds until another code may be sent; counts down by itself. */
function useCountdown(): [number, (n: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return [left, setLeft];
}

/** "Didn't get it? Resend code", which waits out the one-email-a-minute limit instead of failing. */
function Resend({ email, wait, setWait }: { email: string; wait: number; setWait: (n: number) => void }) {
  const { toast } = useSeek();
  const [busy, setBusy] = useState(false);
  return (
    <p className="fine">
      Didn't get it?{' '}
      {wait > 0 ? (
        <span>You can ask for a new code in {wait}s</span>
      ) : (
        <button
          type="button"
          className="linkbtn"
          disabled={busy}
          onClick={async () => {
            if (!backendOn) {
              toast('New code sent');
              return;
            }
            setBusy(true);
            const err = await sendCode(email);
            setBusy(false);
            const n = waitSeconds(err);
            if (n) setWait(n);
            else if (!err) setWait(RESEND_AFTER);
            toast(err || 'New code sent to ' + email);
          }}
        >
          {busy ? 'Sending…' : 'Resend code'}
        </button>
      )}
      {!backendOn && ' · Tip: any 6 digits work in this prototype'}
    </p>
  );
}

export function SignupPage() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(backendOn ? '' : s.email);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useCountdown();
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
        // a code was sent less than a minute ago: it is still good, so go straight to entering it
        const n = waitSeconds(err);
        if (!n) {
          toast(err);
          return;
        }
        setWait(n);
        toast('We already sent you a code. Enter it below');
      } else setWait(RESEND_AFTER);
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
    // a new owner goes straight to organisation setup; invited people set up their profile first
    router.push(!account.workspace && !account.clientSpaces.length ? ROUTES.setup : !account.onboarded ? ROUTES.welcome : homeOf(account));
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
              <button type="button" className="btn lg" onClick={google}>
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
                  <input id="em" className="inp" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <button type="submit" className="btn lg pri" disabled={busy}>
                  {busy ? 'Sending code…' : 'Continue'}
                </button>
              </form>
              <div className="note">
                ✉ <span>We'll email you a 6-digit code. There is no password to remember.</span>
              </div>
              <p className="fine">
                By continuing, you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy policy</a>.
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
                Enter the 6-digit code we sent to <b>{s.email}</b>.
              </p>
              <CodeInput onComplete={verify} />
              <button type="button" className="btn lg pri" onClick={verify} disabled={busy}>
                {busy ? 'Checking…' : 'Verify and continue'}
              </button>
              <Resend email={s.email} wait={wait} setWait={setWait} />
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

/**
 * Organisation setup (build spec 5.4), in three short steps after sign-up and profile:
 * 3) Organisation: logo, name, workspace address (checked on the server), time zone, website;
 * 4) How your team works: team size and use, which decide what we create (this step creates the organisation);
 * 5) Invite your team: emails with a role each, the shareable link, and "anyone at @company can join".
 * The panel on the left is a live preview in the chosen colours. A reload resumes at the same step.
 */
const ACCENTS = THEMES.acc;
const DEFAULT_ACCENT = ACCENTS[0][1];

/** A colour k of the way to black (for the preview's rail). */
function darken(hex: string, k: number) {
  return '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join('');
}

export function SetupPage() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const w = s.ws;
  // two screens: the organisation (name, logo, colour, team), then invites
  const phase = w.step === 'invite' ? 'invite' : 'org';
  const accent = w.accent ?? DEFAULT_ACCENT;
  const autoSlug = slugify(w.name);
  const slug = (w.slug ?? autoSlug).slice(0, 40);
  const [invite, setInvite] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [free, setFree] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logo = preview ?? w.logo ?? null;
  const domain = backendOn ? companyDomain(s.email) : 'convertt.co';
  const ws = (fn: (x: typeof w) => void) =>
    update((d) => {
      fn(d.ws);
    });
  const go = (step: 'org' | 'team' | 'invite') =>
    ws((x) => {
      x.step = step;
    });

  // a fresh form for a real account (not the prototype's sample answers)
  const cleared = useRef(false);
  useEffect(() => {
    if (!backendOn || cleared.current) return;
    cleared.current = true;
    if (w.step) return; // resuming a draft
    ws((x) => {
      if (x.name === 'Convertt') x.name = '';
      x.logo = undefined;
      x.invites = [];
      x.roles = {};
      x.slug = undefined;
      x.allowDomain = false;
      x.tz = guessZone();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  // your company may already be on Seek: offer to join it instead of creating a second workspace
  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string; logo: string | null; members: number }[]>([]);
  useEffect(() => {
    if (backendOn) void joinableOrgs().then(setOrgs).catch(() => {});
  }, []);
  const joinOrg = async (id: string, name: string) => {
    if (saving) return;
    setSaving(true);
    const { error, account } = await joinByDomain(id);
    setSaving(false);
    if (error || !account) {
      toast(error || 'Couldn’t join. Try again');
      return;
    }
    update((d) => {
      applyAccount(d, account);
      d.workspaces.C.ch = 'general';
      d.ws.step = undefined;
    });
    toast('You joined ' + name);
    router.push(ROUTES.channels);
  };

  // is the address free? (checked on the server, 400ms after typing stops)
  useEffect(() => {
    if (!backendOn || phase !== 'org') return;
    if (!/^[a-z0-9]{2,40}$/.test(slug)) {
      setFree(null);
      return;
    }
    setFree(null);
    let alive = true;
    const t = setTimeout(async () => {
      const ok = await slugAvailable(slug).catch(() => null);
      if (alive) setFree(ok);
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [slug, phase]);

  const creates: [string, string][] = [
    ['general', 'everyone'],
    ['announcements', 'team news'],
    ['random', 'off-topic'],
  ];
  if (w.use.includes('Client work')) creates.push(['Clients', 'ready for your first client']);
  if (w.use.includes('Tasks and decisions')) creates.push(['Decisions', 'log and approvals']);

  const pickLogo = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) {
      toast('Choose a PNG, JPG or WebP image');
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      toast('That image is over 2 MB. Choose a smaller one');
      return;
    }
    setLogoFile(f);
    setPreview(URL.createObjectURL(f));
  };

  /** Adds one or many emails (pasted lists too); invalid ones are reported, not added. */
  const addInvites = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.filter((p) => !isEmail(p));
    ws((x) => {
      for (const p of parts) if (isEmail(p) && !x.invites.includes(p.toLowerCase())) x.invites.push(p.toLowerCase());
    });
    setInvite(bad.join(' '));
    if (bad.length) toast(`${bad.length === 1 ? bad[0] + ' isn’t' : bad.length + ' of those aren’t'} a valid email`);
  };

  const toTeam = () => {
    const n = w.name.trim();
    if (n.length < 2 || n.length > 50) {
      toast('Enter your organisation’s name (2 to 50 characters)');
      return;
    }
    if (backendOn && !/^[a-z0-9]{2,40}$/.test(slug)) {
      toast('The address can use lowercase letters and numbers (2 to 40)');
      return;
    }
    if (backendOn && free === false) {
      toast('That address is taken. Try ' + slug + 'studio');
      return;
    }
    void createOrg();
  };

  const createOrg = async () => {
    if (!backendOn) {
      setCode('demo-link');
      go('invite');
      return;
    }
    if (saving) return;
    setSaving(true);
    const { error: err, id } = await createOrganisation({ name: w.name, slug, tz: w.tz, size: w.size, use: w.use, accent, website: w.website ?? '', allowDomain: false });
    if (err || !id) {
      setSaving(false);
      toast(err || 'Couldn’t create the organisation. Try again');
      if (err?.includes('address')) go('org');
      return;
    }
    let url: string | null = null;
    if (logoFile) {
      const r = await uploadLogo(id, logoFile);
      if (r.error) toast(r.error + '. You can add it later from your profile');
      url = r.url;
    }
    // the owner's profile starts from their email; they can change it any time from their profile
    let acc = await currentAccount(true);
    if (acc && !acc.onboarded) {
      await saveProfile({ name: acc.name.trim() || acc.email.split('@')[0], title: '' });
      acc = await currentAccount(true);
    }
    setSaving(false);
    setCode(acc?.workspace?.joinCode ?? null);
    update((d) => {
      d.ws.logo = url ?? undefined;
      if (acc?.workspace) d.ws.name = acc.workspace.name;
      d.ws.step = 'invite';
      // the brand colour becomes the app's accent
      d.theme = { ...d.theme, acc: accent };
    });
  };

  const finish = async (skip = false) => {
    let failed = 0;
    let sent = 0;
    if (backendOn) {
      if (saving) return;
      setSaving(true);
      const acc = await currentAccount();
      const id = acc?.workspace?.id;
      if (id && domain && w.allowDomain) await setDomainJoin(id, true);
      for (const e of id && !skip ? w.invites : []) {
        if ((await sendInvite(id!, e, { role: 'member' })).ok) sent++;
        else failed++;
      }
      setSaving(false);
      update((d) => {
        if (acc) applyAccount(d, acc);
        d.workspaces.C.ch = 'general';
        d.ws.step = undefined;
        d.ws.invites = [];
      });
    } else {
      sent = skip ? 0 : w.invites.length;
      update((d) => {
        d.session = 'in';
        d.workspaces.C.ch = 'general';
        d.ws.step = undefined;
      });
    }
    toast(
      failed
        ? `${w.name} is ready. ${failed} invite email${failed === 1 ? '' : 's'} couldn’t be sent; share the invite link instead`
        : `Workspace ${w.name} is ready${sent ? ` · ${sent} invite${sent === 1 ? '' : 's'} sent` : ''}`,
    );
    router.push(ROUTES.channels);
  };

  const n = phase === 'org' ? 2 : 3;
  // five steps don't fit the card: only the current one shows its name (the others on hover)
  const steps = (
    <div className="steps compact" aria-label={'Step ' + n + ' of 3'}>
      {(
        [
          ['Account', 1],
          ['Organisation', 2],
          ['Invite', 3],
        ] as [string, number][]
      ).map(([t, i], k) => (
        <span key={t} style={{ display: 'contents' }}>
          {k > 0 && <hr />}
          <span className={i < n ? 'd' : i === n ? 'c' : ''} title={t} aria-current={i === n ? 'step' : undefined}>
            <i>{i < n ? '✓' : i}</i>
            {t}
          </span>
        </span>
      ))}
    </div>
  );

  const rail = darken(accent, 0.28);

  return (
    <main className="auth">
      <div className="art">
        <Brand />
        <h2>
          {phase === 'invite' ? (
            <>
              Bring <em>your team</em> in.
            </>
          ) : (
            <>
              Set up for how <em>your team works.</em>
            </>
          )}
        </h2>
        <p>
          {phase === 'org'
            ? 'Give your workspace its own identity. The preview updates as you type.'
            : 'Invite by email, or share one link in your team chat. You can choose who sees which channels later.'}
        </p>
        <div className="pc" style={{ maxWidth: 420, padding: 0, overflow: 'hidden', display: 'flex' }}>
          <div style={{ background: rail, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <span style={{ borderRadius: 10, boxShadow: '0 0 0 2px #fff' }}>
              <OrgMark name={w.name} logo={logo} size={34} color={accent} />
            </span>
          </div>
          <div style={{ padding: '12px 14px', flex: 1, minWidth: 0 }}>
            <b style={{ display: 'block' }}>{w.name.trim() || 'Your organisation'}</b>
            <div style={{ color: 'var(--sb)', fontSize: 12 }} className="mono">
              {slug || 'your-team'}.seek.app
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 10, fontSize: 13 }}>
              {creates
                .filter(([a]) => a !== 'Clients' && a !== 'Decisions')
                .map(([a], i) => (
                  <span key={a} style={{ padding: '3px 8px', borderRadius: 6, background: i === 0 ? accent : 'transparent', color: i === 0 ? '#fff' : 'var(--mu)', fontWeight: i === 0 ? 600 : 400 }}>
                    # {a}
                  </span>
                ))}
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
          {steps}

          {phase === 'org' && orgs.length > 0 && (
            <div className="card">
              <div className="ct">
                <b>Your team is already on Seek</b>
              </div>
              {orgs.map((o) => (
                <div key={o.id} className="trow" style={{ alignItems: 'center' }}>
                  <span className="joinorg">
                    <OrgMark name={o.name} logo={o.logo} size={36} />
                    <span>
                      <b>{o.name}</b>
                      <small>
                        {o.slug}.seek.app · {o.members} {o.members === 1 ? 'person' : 'people'} · anyone at @{domain} can join
                      </small>
                    </span>
                  </span>
                  <button type="button" className="btn sm pri" disabled={saving} onClick={() => void joinOrg(o.id, o.name)}>
                    Join
                  </button>
                </div>
              ))}
              <small style={{ color: 'var(--sb)' }}>Or create a new workspace below.</small>
            </div>
          )}

          {phase === 'org' && (
            <>
              <div>
                <h1>Set up your organisation</h1>
              </div>
              <p className="sub">Your team and clients see this name, logo and colour everywhere in Seek.</p>
              <div className="fld">
                <label>
                  Logo <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(optional)</span>
                </label>
                <div
                  className="logopick"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    pickLogo(e.dataTransfer.files?.[0]);
                  }}
                >
                  <OrgMark name={w.name} logo={logo} size={56} color={accent} />
                  <div className="acts">
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
                        {logo ? 'Change' : 'Upload logo'}
                      </button>
                      {logo && (
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() => {
                            setLogoFile(null);
                            setPreview(null);
                            ws((x) => {
                              x.logo = undefined;
                            });
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </span>
                    <small>PNG, JPG or WebP up to 2 MB. Cropped to a square. Or drag it here.</small>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      pickLogo(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
              <div className="fld">
                <label htmlFor="wsn">Organisation name</label>
                <input
                  className="inp"
                  id="wsn"
                  placeholder="e.g. Convertt"
                  autoComplete="organization"
                  maxLength={50}
                  value={w.name}
                  onChange={(e) =>
                    ws((x) => {
                      x.name = e.target.value;
                    })
                  }
                />
              </div>
              <div className="fld">
                <label htmlFor="wsa">Workspace address</label>
                <div className="copyrow">
                  <input
                    className="inp mono"
                    id="wsa"
                    placeholder="convertt"
                    value={slug}
                    onChange={(e) =>
                      ws((x) => {
                        x.slug = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
                      })
                    }
                  />
                  <span className="mono" style={{ color: 'var(--sb)', fontSize: 13 }}>
                    .seek.app
                  </span>
                </div>
                <em style={{ color: free === false ? 'var(--red)' : free ? 'var(--ok)' : undefined }}>
                  {!backendOn || !slug
                    ? 'Filled in from the name. Lowercase letters and numbers.'
                    : !/^[a-z0-9]{2,40}$/.test(slug)
                      ? 'At least 2 letters or numbers'
                      : free === null
                        ? 'Checking…'
                        : free
                          ? '✓ Available'
                          : `✗ Taken, try ${slug}studio`}
                </em>
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
                  {[...new Set([w.tz, ...ZONES])].map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
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
              <button type="button" className="btn lg pri" onClick={toTeam} disabled={saving}>
                {saving ? 'Creating your workspace…' : 'Continue'}
              </button>
              <p className="fine">You can change all of this later.</p>
            </>
          )}

          {phase === 'invite' && (
            <>
              <div>
                <h1>Invite your team</h1>
              </div>
              <p className="sub">They get an email with a Join button and a sign-in code. Or share the invite link.</p>
              <div className="fld">
                <label htmlFor="invIn">Emails</label>
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
                    placeholder="Add emails, press Enter"
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    onPaste={(e) => {
                      const t = e.clipboardData.getData('text');
                      if (/[\s,;]/.test(t.trim())) {
                        e.preventDefault();
                        addInvites(t);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addInvites(invite);
                      }
                    }}
                    onBlur={() => invite.trim() && addInvites(invite)}
                  />
                </div>
                <em>Paste a list to add several at once.</em>
              </div>
              <InviteLink code={code ?? (backendOn ? null : 'demo-link')} onCode={setCode} />
              <button type="button" className="btn lg pri" onClick={() => void finish()} disabled={saving}>
                {saving ? 'Sending invites…' : w.invites.length ? `Send ${w.invites.length} invite${w.invites.length === 1 ? '' : 's'} and open #general` : 'Continue to #general'}
              </button>
              <p className="fine">
                <button type="button" className="linkbtn" onClick={() => void finish(true)} disabled={saving}>
                  Skip, I'll invite later
                </button>{' '}
                · 🔒 Secure sign-in · Your data is encrypted
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/** The browser's time zone as one of our labels (falls back to the first). */
function guessZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const off = -new Date().getTimezoneOffset() / 60;
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? '';
    const known = ZONES.find((z) => city && z.startsWith(city));
    if (known) return known;
    return city ? `${city} (GMT${off >= 0 ? '+' : ''}${off})` : ZONES[0];
  } catch {
    return ZONES[0];
  }
}

/**
 * Welcome: where invite emails land (their Join button) and where everyone sets up their profile once, after
 * their first sign-in. Invited people then go straight into their team's #general; people who signed up on
 * their own go on to set up an organization.
 */
export function WelcomePage() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const [phase, setPhase] = useState<'loading' | 'join' | 'code' | 'profile'>('loading');
  const [invite, setInvite] = useState<{ workspace: string; invitedBy: string; logo: string | null; client?: boolean } | null>(null);
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [tz, setTz] = useState(ZONES[0]);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useCountdown();
  const token = useRef<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  // a client's invite email: Join now opens this code screen (as in the prototype)
  const [clientJoin, setClientJoin] = useState(false);

  /** Signed in: set up the profile, or carry on if that's already done. */
  const toProfile = async (acc: Account) => {
    if (!acc.workspace && !acc.clientSpaces.length) {
      router.replace(ROUTES.setup);
      return;
    }
    if (acc.onboarded) {
      router.replace(homeOf(acc));
      return;
    }
    const client = !acc.workspace ? acc.clientSpaces[0] : undefined;
    if (client) {
      // clients go straight into their space (no profile step); they can add their name in Settings
      await saveProfile({ name: acc.name.trim() || acc.email.split('@')[0], title: acc.title, timeZone: acc.timeZone || undefined });
      const fresh = await currentAccount(true);
      if (fresh) update((d) => applyAccount(d, fresh));
      toast('Welcome to ' + client.name + ' 👋');
      router.replace(ROUTES.clients);
      return;
    }
    setHasWorkspace(!!acc.workspace);
    if (acc.workspace) {
      const inv = await myInvite().catch(() => null);
      // joined with an invite link (no email invite): just the organization
      setInvite({ workspace: inv?.workspace ?? acc.workspace.name, invitedBy: inv?.invitedBy ?? '', logo: acc.workspace.logo });
    } else setInvite(null);
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
      // an invite to someone who already has an account: open the organisation they were invited to
      const org = q.get('org');
      if (org) preferOrg(org);
      setEmail(q.get('email') ?? '');
      const th = q.get('token_hash');
      if (q.get('client') && !th) {
        const signedInAlready = await currentAccount().catch(() => null);
        if (!signedInAlready) {
          history.replaceState(null, '', location.pathname);
          setClientJoin(true);
          setPhase('code');
          return;
        }
      }
      if (th) {
        // keep the one-time link out of the address bar and history
        token.current = th;
        history.replaceState(null, '', location.pathname);
        setPhase('join');
        return;
      }
      const acc = await currentAccount(!!org).catch(() => null);
      if (!acc) router.replace(ROUTES.signup);
      else {
        update((d) => applyAccount(d, acc));
        await toProfile(acc);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signedIn = async (acc: Account) => {
    update((d) => applyAccount(d, acc));
    await toProfile(acc);
  };

  const join = async () => {
    if (busy) return;
    if (!token.current) {
      setPhase('code');
      return;
    }
    setBusy(true);
    const { error, account } = await acceptInviteLink(token.current);
    setBusy(false);
    if (!error && account) {
      await signedIn(account);
      return;
    }
    // the link was already used or has expired: the same email also has a 6-digit code, so no new email is needed
    token.current = null;
    setPhase('code');
    toast('Enter the 6-digit code from your invite email');
  };

  const verify = async (typed?: string) => {
    const code = typed ?? [...(formRef.current?.querySelectorAll<HTMLInputElement>('.codes input') ?? [])].map((x) => x.value).join('');
    if (!isEmail(email.trim())) {
      toast('Enter the email address the invite was sent to');
      return;
    }
    if (code.length < 6) {
      toast('Enter all 6 digits');
      return;
    }
    if (busy) return;
    setBusy(true);
    const { error, account } = await verifyCode(email.trim(), code, 'invite');
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
    const acc = err ? null : await currentAccount(true);
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
    router.push(homeOf(acc));
  };

  const shown = name.trim() || 'Your name';
  const ws = invite?.workspace;

  return (
    <main className="auth">
      <div className="art">
        <Brand />
        {ws && (
          <div className="joinorg">
            <OrgMark name={ws} logo={invite?.logo} size={44} />
            <b style={{ fontSize: 17 }}>{ws}</b>
          </div>
        )}
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
            ? invite.invitedBy
              ? `${invite.invitedBy} invited you. Tell the team who you are, then you're in.`
              : `Tell the ${invite.workspace} team who you are, then you're in.`
            : clientJoin
              ? 'Your agency set up a private space for you: chat with the team, follow progress and approve work in one place.'
              : phase === 'join' || phase === 'code'
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
        {email && phase === 'profile' && <div className="top">Signed in as {email}</div>}
        <div className="in">
          {phase === 'loading' && <p className="sub">Loading…</p>}

          {phase === 'join' && (
            <>
              <div>
                <h1>You're invited</h1>
              </div>
              <p className="sub">
                Join your team on Seek
                {email ? (
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
              <p className="fine">
                Next, you'll set up your profile. ·{' '}
                <button type="button" className="linkbtn" onClick={() => setPhase('code')}>
                  Use the code from the email instead
                </button>
              </p>
            </>
          )}

          {phase === 'code' && clientJoin && (
            <div className="cjoin">
              <span className="av" style={{ width: 52, height: 52, background: 'var(--gold)', borderRadius: 14, fontSize: 20 }}>
                ✦
              </span>
              <div>
                <b style={{ fontSize: 13, color: 'var(--sb)' }}>Your project space</b>
                <h1 style={{ margin: '4px 0 0' }}>Welcome</h1>
              </div>
              <p className="sub" style={{ margin: 0 }}>
                Enter the 6-digit code we just emailed you{isEmail(email) ? ' at ' + email : ''}.
              </p>
              {!isEmail(email) && (
                <div className="fld" style={{ width: '100%', textAlign: 'left' }}>
                  <label htmlFor="wem2">Your email</label>
                  <input id="wem2" className="inp" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              )}
              <CodeInput onComplete={(c) => void verify(c)} label="Sign-in code" />
              <button type="button" className="btn lg gold" style={{ width: '100%' }} onClick={() => void verify()} disabled={busy}>
                {busy ? 'Opening…' : 'Open my space'}
              </button>
              {isEmail(email) && <Resend email={email} wait={wait} setWait={setWait} />}
              <p className="fine">No password. The code is in the same email as the Join button.</p>
            </div>
          )}

          {phase === 'code' && !clientJoin && (
            <>
              <div>
                <h1>Enter your code</h1>
              </div>
              <p className="sub">Your invite email has a 6-digit code under the Join button. Enter it here.</p>
              {!isEmail(email) && (
                <div className="fld">
                  <label htmlFor="wem">Your email</label>
                  <input id="wem" className="inp" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              )}
              <CodeInput onComplete={(c) => void verify(c)} />
              <button type="button" className="btn lg pri" onClick={() => void verify()} disabled={busy}>
                {busy ? 'Checking…' : 'Join'}
              </button>
              {isEmail(email) && <Resend email={email} wait={wait} setWait={setWait} />}
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
                      <i>3</i>Organisation
                    </span>
                  </>
                )}
              </div>
              <div>
                <h1>Set up your profile</h1>
              </div>
              <p className="sub">{invite?.client ? `This is how you'll appear to the team in ${invite.workspace}.` : invite ? `This is how you'll appear to ${invite.invitedBy || 'your teammates'} and the rest of ${invite.workspace}.` : 'This is how you’ll appear to your team.'}</p>
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
              <p className="fine">🔒 Only people in your organization can see your profile.</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * Join with an invite link (/join?c=…): shows the organization, then email → 6-digit code → join.
 * People who are already signed in join with one click. New people set up their profile next.
 */
export function JoinPage() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const [phase, setPhase] = useState<'loading' | 'bad' | 'join' | 'email' | 'code'>('loading');
  const [org, setOrg] = useState<{ name: string; logo: string | null; members: number } | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useCountdown();
  const code = useRef('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const c = new URLSearchParams(location.search).get('c') ?? '';
      code.current = c;
      if (!backendOn) {
        setOrg({ name: s.ws.name || 'Convertt', logo: null, members: 4 });
        setPhase('email');
        return;
      }
      if (!c) {
        setPhase('bad');
        return;
      }
      const [info, acc] = await Promise.all([joinInfo(c).catch(() => null), currentAccount().catch(() => null)]);
      if (!info) {
        setPhase('bad');
        return;
      }
      setOrg(info);
      if (acc) {
        setEmail(acc.email);
        setPhase('join');
      } else setPhase('email');
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Signed in: join, then set up a profile (new people) or open the team's channels. */
  const joinNow = async () => {
    if (!backendOn) {
      update((d) => {
        d.session = 'profile';
      });
      router.push(ROUTES.welcome);
      return;
    }
    setBusy(true);
    const { error, account } = await joinByCode(code.current);
    setBusy(false);
    if (error || !account) {
      toast(error || 'Couldn’t join. Try again');
      if (error?.includes('isn’t valid')) setPhase('bad');
      return;
    }
    update((d) => {
      applyAccount(d, account);
      d.workspaces.C.ch = 'general';
    });
    if (account.onboarded) toast(`Welcome to ${org?.name ?? 'the team'} 👋`);
    router.replace(account.onboarded ? ROUTES.channels : ROUTES.welcome);
  };

  const sendTo = async () => {
    const v = email.trim();
    if (!isEmail(v)) {
      toast('Enter a valid email');
      return;
    }
    if (backendOn) {
      setBusy(true);
      const err = await sendCode(v);
      setBusy(false);
      const n = waitSeconds(err);
      if (err && !n) {
        toast(err);
        return;
      }
      setWait(n || RESEND_AFTER);
      if (n) toast('We already sent you a code. Enter it below');
    }
    setPhase('code');
  };

  const verify = async (typed: string) => {
    if (!backendOn) {
      await joinNow();
      return;
    }
    if (busy) return;
    setBusy(true);
    const { error, account } = await verifyCode(email.trim(), typed);
    setBusy(false);
    if (error || !account) {
      toast(error || 'Couldn’t sign you in. Try again');
      return;
    }
    await joinNow();
  };

  const name = org?.name ?? 'your team';
  const orgCard = org && (
    <div className="joinorg">
      <OrgMark name={org.name} logo={org.logo} size={48} />
      <div>
        <b style={{ fontSize: 16 }}>{org.name}</b>
        <small>
          {org.members} {org.members === 1 ? 'person' : 'people'} on Seek
        </small>
      </div>
    </div>
  );

  return (
    <main className="auth">
      <div className="art">
        <Brand />
        {org && (
          <div className="joinorg">
            <OrgMark name={org.name} logo={org.logo} size={56} />
            <div>
              <b style={{ fontSize: 19 }}>{org.name}</b>
              <small style={{ color: '#d9c4d9' }}>
                {org.members} {org.members === 1 ? 'person' : 'people'} on Seek
              </small>
            </div>
          </div>
        )}
        <h2>
          Join <em>{name}</em> on Seek.
        </h2>
        <p>Messages, decisions and client work in one tidy workspace. No password needed: we'll email you a code.</p>
      </div>
      <div className="fm">
        <div className="mbrand">
          <Logo />
        </div>
        <div className="in">
          {phase === 'loading' && <p className="sub">Loading…</p>}

          {phase === 'bad' && (
            <>
              <div>
                <h1>This link doesn't work</h1>
              </div>
              <p className="sub">The invite link is wrong or has been reset. Ask your team for a new one.</p>
              <button type="button" className="btn lg" onClick={() => router.push(ROUTES.signup)}>
                Sign in or create an account
              </button>
            </>
          )}

          {phase === 'join' && (
            <>
              {orgCard}
              <div>
                <h1>Join {name}</h1>
              </div>
              <p className="sub">
                You're signed in as <b>{email}</b>.
              </p>
              <button type="button" className="btn lg pri" onClick={joinNow} disabled={busy}>
                {busy ? 'Joining…' : `Join ${name}`}
              </button>
            </>
          )}

          {phase === 'email' && (
            <form
              style={{ display: 'contents' }}
              onSubmit={(e) => {
                e.preventDefault();
                void sendTo();
              }}
            >
              {orgCard}
              <div>
                <h1>Join {name}</h1>
              </div>
              <p className="sub">Enter your email. We'll send you a 6-digit code to confirm it's you.</p>
              <div className="fld">
                <label htmlFor="jem">Work email</label>
                <input id="jem" className="inp" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </div>
              <button type="submit" className="btn lg pri" disabled={busy}>
                {busy ? 'Sending code…' : 'Continue'}
              </button>
              <p className="fine">Next, you'll set up your profile.</p>
            </form>
          )}

          {phase === 'code' && (
            <>
              <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPhase('email')}>
                ← Change email
              </button>
              <div>
                <h1>Check your email</h1>
              </div>
              <p className="sub">
                Enter the 6-digit code we sent to <b>{email}</b>.
              </p>
              <CodeInput onComplete={(c) => void verify(c)} />
              <p className="fine" style={{ marginTop: -4 }}>
                {busy ? 'Checking…' : 'You’ll join as soon as the code is right.'}
              </p>
              <Resend email={email} wait={wait} setWait={setWait} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
