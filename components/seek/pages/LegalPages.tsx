import Link from 'next/link';
import { Logo } from '../ui';
import { Ic } from '../icons';

/** Plain public pages that sign-up and Google's sign-in screen link to. */
function Legal({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="legal" style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 60px', lineHeight: 1.65, color: 'var(--ink)' }}>
      <Link href="/signup" aria-label="Seek home" style={{ textDecoration: 'none', color: 'inherit' }}>
        <Logo />
      </Link>
      <h1 style={{ margin: '28px 0 4px', fontSize: 30, letterSpacing: '-.02em' }}>{title}</h1>
      <p style={{ margin: 0, color: 'var(--sb)', fontSize: 13 }}>Last updated {updated}</p>
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
      <p style={{ marginTop: 32 }}>
        <Link href="/signup"><Ic n="back" size={14} /> Back to Seek</Link>
      </p>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <Legal title="Privacy policy" updated="12 November 2026">
      <p>Seek is team chat for agencies, made by Convertt. This page explains what we collect and why.</p>
      <h2 style={{ fontSize: 18, margin: '14px 0 0' }}>What we collect</h2>
      <ul>
        <li>Your email address, and your name, title and time zone if you add them.</li>
        <li>If you sign in with Google: your name, email address and profile picture from your Google account. We don&apos;t get your Google password or anything else from your Google account.</li>
        <li>What you and your team put in Seek: organisations, channels, messages, reactions, client spaces and logos.</li>
      </ul>
      <h2 style={{ fontSize: 18, margin: '14px 0 0' }}>How we use it</h2>
      <ul>
        <li>To sign you in, run your workspace and show your messages to the people they are meant for.</li>
        <li>To send the emails Seek needs: sign-in codes and invites.</li>
      </ul>
      <p>We don&apos;t sell your data or use it for advertising.</p>
      <h2 style={{ fontSize: 18, margin: '14px 0 0' }}>Who can see it</h2>
      <ul>
        <li>People in your organisation see the channels they belong to. Clients see only their own client space and never your Team notes.</li>
        <li>We use Supabase to store data and sign people in, Vercel to host the app, and Brevo to send emails. They process data for us only to run Seek.</li>
      </ul>
      <h2 style={{ fontSize: 18, margin: '14px 0 0' }}>Your choices</h2>
      <p>You can change your profile at any time. To delete your account or your organisation&apos;s data, ask your workspace owner or contact the Convertt team.</p>
    </Legal>
  );
}

export function TermsPage() {
  return (
    <Legal title="Terms of service" updated="12 November 2026">
      <p>These terms apply when you use Seek, team chat for agencies made by Convertt.</p>
      <ul>
        <li>You are responsible for what you post and for keeping your sign-in email secure.</li>
        <li>Workspace owners and admins decide who joins their organisation and which channels people can see.</li>
        <li>Don&apos;t use Seek to break the law, send spam or harm other people.</li>
        <li>Seek is in early access. We work to keep it available and your data safe, but it is provided as it is, without guarantees.</li>
        <li>We may update these terms; the date above shows the latest version.</li>
      </ul>
      <p>Questions? Contact the Convertt team.</p>
    </Legal>
  );
}
