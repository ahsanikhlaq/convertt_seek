'use client';

import { Fragment } from 'react';
import { PEOPLE, type PersonKey, type Mode } from '@/lib/seek/data';
import { useSeek } from '@/lib/seek/store';
import { usePresenceOf } from '@/lib/seek/presence';
import { Ic, type IconKey } from './icons';

/** A person's picture or initials. With `presence`, a green dot shows when they're active (grey ring when not). */
export function Avatar({ k, size = 32, className = '', presence }: { k: PersonKey; size?: number; className?: string; presence?: boolean }) {
  const p = PEOPLE[k] ?? { name: k, color: '#7a6179', role: '' };
  const pr = usePresenceOf(presence ? k : null);
  const av = (
    <span
      className={'av ' + className}
      style={{ width: size, height: size, background: p.color, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
      title={p.name}
    >
      {p.photo ? <img src={p.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }} /> : k === 'AI' ? <Ic n="ai" size={Math.round(size * 0.5)} /> : (p.initials ?? k)}
    </span>
  );
  if (!pr.known) return av;
  return (
    <span className="pav" title={p.name + ' · ' + pr.label}>
      {av}
      <i className={'pdot' + (pr.active ? ' on' : '')} style={{ width: Math.max(9, Math.round(size * 0.3)), height: Math.max(9, Math.round(size * 0.3)) }} role="img" aria-label={pr.label} />
    </span>
  );
}

/** "Active now" or "Last seen 5 min ago" for someone (nothing in demo mode or for you). */
export function SeenText({ id, prefix = '' }: { id: string | null | undefined; prefix?: string }) {
  const pr = usePresenceOf(id);
  if (!pr.known) return null;
  return (
    <span className={'seen' + (pr.active ? ' on' : '')}>
      {prefix}
      {pr.label}
    </span>
  );
}

const ICONS = {
  team: <path d="M4 6h16M4 12h16M4 18h10" />,
  dm: <path d="M4 5h16v11H8l-4 4z" />,
  cl: <path d="M4 20V8l8-4 8 4v12M9 20v-6h6v6" />,
  mt: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  dc: <path d="M12 3l9 9-9 9-9-9z" />,
  ap: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  ai: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
};
export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** A reaction / emoji key: '+1', a unicode emoji, or ':custom-name:' */
export function Emoji({ k, large }: { k: string; large?: boolean }) {
  const { s } = useSeek();
  if (k === '+1') return <>👍</>;
  if (k.startsWith(':') && k.endsWith(':') && k.length > 2) {
    const n = k.slice(1, -1);
    const c = s.custom.find((x) => x.n === n);
    // eslint-disable-next-line @next/next/no-img-element
    return c ? <img className={'cemo' + (large ? ' lg' : '')} alt={k} title={k} src={c.src} /> : <>{k}</>;
  }
  return <>{k}</>;
}

/** Message text with @mentions highlighted and :custom: emoji rendered */
// inline formatting, like Slack: *bold* _italic_ ~strike~ `code`, links, @mentions and :emoji:
const INLINE = /(`[^`\n]+`|(?<![\w*])\*[^*\n]+\*(?![\w*])|(?<![\w_])_[^_\n]+_(?![\w_])|(?<![\w~])~[^~\n]+~(?![\w~])|https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]|@\w+|:[a-z0-9_-]+:)/g;

function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        if (p.startsWith('`')) return <code key={i} className="icode">{p.slice(1, -1)}</code>;
        if (p.startsWith('*')) return <b key={i}><Inline text={p.slice(1, -1)} /></b>;
        if (p.startsWith('_')) return <em key={i}><Inline text={p.slice(1, -1)} /></em>;
        if (p.startsWith('~')) return <s key={i}><Inline text={p.slice(1, -1)} /></s>;
        if (p.startsWith('http')) return <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="mlink">{p}</a>;
        if (p.startsWith('@')) return <span key={i} className="at">{p}</span>;
        return <Emoji key={i} k={p} />;
      })}
    </>
  );
}

/** Message text with Slack-style formatting: code blocks, "- " bullet lines, and inline styles. */
export function RichText({ text }: { text: string }) {
  const blocks = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {blocks.map((b, i) => {
        if (!b) return null;
        if (b.startsWith('```') && b.endsWith('```') && b.length >= 6) return <pre key={i} className="cblock">{b.slice(3, -3).replace(/^\n|\n$/g, '')}</pre>;
        const lines = b.split('\n');
        return (
          <Fragment key={i}>
            {lines.map((l, j) => {
              const bullet = /^\s*[-•*] (.*)$/.exec(l);
              const quote = /^> ?(.*)$/.exec(l);
              const end = j < lines.length - 1 ? '\n' : '';
              if (bullet) return <span key={j} className="bul"><Inline text={bullet[1]} /></span>;
              if (quote) return <span key={j} className="qline"><Inline text={quote[1]} /></span>;
              return <Fragment key={j}><Inline text={l} />{end}</Fragment>;
            })}
          </Fragment>
        );
      })}
    </>
  );
}

export function Switch({ on, onClick, disabled, label, danger }: { on: boolean; onClick: () => void; disabled?: boolean; label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={'sw' + (on ? ' on' : '')}
      onClick={onClick}
      disabled={disabled}
      style={danger && on ? { background: 'var(--red)' } : undefined}
    />
  );
}

export function ModeSeg() {
  const { s, update, toast } = useSeek();
  const opts: [Mode, IconKey, string][] = [
    ['light', 'sun', 'Light'],
    ['dark', 'moon', 'Dark'],
    ['system', 'system', 'System'],
  ];
  return (
    <div className="modeseg" role="group" aria-label="Appearance">
      {opts.map(([k, i, l]) => (
        <button
          key={k}
          type="button"
          className={s.mode === k ? 'on' : ''}
          aria-pressed={s.mode === k}
          onClick={() => {
            update((d) => {
              d.mode = k;
            });
            toast(k === 'system' ? 'Appearance follows your device' : k === 'dark' ? 'Dark mode on' : 'Light mode on');
          }}
        >
          <Ic n={i} size={14} /> <span>{l}</span>
        </button>
      ))}
    </div>
  );
}

export function Logo({ small = true }: { small?: boolean }) {
  return (
    <span className="slogo">
      <i>S</i>
      <b>Seek</b>
      {small && <small>by Convertt</small>}
    </span>
  );
}

/** An organization's logo, or its first letter on a purple square when it has none. */
export function OrgMark({ name, logo, size = 36, radius, color }: { name: string; logo?: string | null; size?: number; radius?: number; color?: string }) {
  const r = radius ?? Math.round(size * 0.28);
  return (
    <span className="orgmark" style={{ width: size, height: size, borderRadius: r, fontSize: Math.round(size * 0.42), ...(color ? { background: color } : {}) }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo} alt="" /> : (name.trim()[0] || 'S').toUpperCase()}
    </span>
  );
}

export function StatusDot() {
  const { s } = useSeek();
  return <span className={'st ' + s.status.k}></span>;
}
