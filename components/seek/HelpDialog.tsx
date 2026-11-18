'use client';

import Link from 'next/link';
import { ROUTES } from '@/lib/seek/routes';
import { Modal } from './Dialogs';
import { Ic } from './icons';

const mac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Help: keyboard shortcuts, "/" commands, and where to find the main settings. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const mod = mac() ? '⌘' : 'Ctrl';
  const keys: [string, string][] = [
    [mod + ' K', 'Search messages, people, files and screens'],
    ['/', 'Commands in any message box (huddle, catch up, tasks…)'],
    ['Enter', 'Send (change it in Account settings → Messages)'],
    ['Shift Enter', 'New line'],
    [mod + ' B / ' + mod + ' I', 'Bold / italic'],
    [mod + ' Shift X', 'Strikethrough'],
    ['@', 'Mention someone; @assistant asks the AI assistant'],
    ['Esc', 'Close a dialog, menu or thread'],
  ];
  const how: [string, string, string][] = [
    ['bell', 'Notifications on your phone or computer', ROUTES.account + '?tab=notifications'],
    ['mail', 'Email when you’re away, or a daily summary', ROUTES.account + '?tab=notifications'],
    ['calendar', 'Google Calendar & Meet for meetings and huddles', ROUTES.apps],
    ['ai', 'AI agents, and teaching the assistant', ROUTES.agents],
    ['users', 'Everyone on your team', ROUTES.people],
  ];
  return (
    <Modal title="Help" icon={<Ic n="help" />} onClose={onClose} width={560} footer={<button type="button" className="btn" onClick={onClose}>Done</button>}>
      <div className="mb">
        <div className="help-sec">
          <b>Keyboard</b>
          <div className="help-keys">
            {keys.map(([k, d]) => (
              <div key={k}>
                <span>
                  {k.split(' ').map((x, i) => (x === '/' && k !== '/' ? <span key={i}> / </span> : <kbd key={i}>{x}</kbd>))}
                </span>
                <small>{d}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="help-sec">
          <b>Set it up</b>
          <div className="help-links">
            {how.map(([i, t, href]) => (
              <Link key={t} href={href} onClick={onClose}>
                <Ic n={i as 'bell'} size={15} />
                <span>{t}</span>
                <Ic n="chevron" size={14} />
              </Link>
            ))}
          </div>
        </div>
        <p className="help-foot">Something not working, or missing? Tell your workspace owner. They can reach the Seek team.</p>
      </div>
    </Modal>
  );
}
