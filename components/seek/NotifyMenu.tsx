'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Ic } from './icons';

export type Level = 'normal' | 'all' | 'digest' | 'mute';
export const LEVELS: [Level, string, string][] = [
  ['normal', 'Normal', 'Follows your default in Account settings'],
  ['all', 'Everything', 'Every new message notifies you'],
  ['digest', 'Digest', 'Waits for the summary instead of notifying'],
  ['mute', 'Mute', 'Nothing, except when someone mentions you'],
];

/**
 * A channel's notification level as a small menu (Normal / Everything / Digest / Mute, each with one line on what it
 * does). The button shows the current level; on phones it is a bell with the menu above the tab bar.
 */
export function NotifyMenu({ value, channel, onPick }: { value: Level; channel: string; onPick: (l: Level) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const cur = LEVELS.find((x) => x[0] === value) ?? LEVELS[0];

  useEffect(() => {
    if (!open) return;
    // focus the chosen level; arrows move, Escape closes (back to the button), a click outside closes
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
    const down = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('touchstart', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const move = (e: React.KeyboardEvent) => {
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (to == null) {
      if (e.key === 'Tab') setOpen(false);
      return;
    }
    e.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  };

  return (
    <span className="nmenu-w">
      <button
        ref={btn}
        type="button"
        className="btn sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Notifications for #${channel}: ${cur[1]}`}
        title={`Notifications: ${cur[1]}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Ic n="bell" /> <span className="hide-m">{cur[1]}</span>
        <Ic n="down" size={13} className="hide-m" />
      </button>
      {open && (
        <div ref={box} id={id} className="nmenu" role="menu" aria-label={`Notifications for #${channel}`} onKeyDown={move}>
          <div className="nmenu-h">Notify me about #{channel}</div>
          {LEVELS.map(([k, l, d]) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={k === value}
              className={k === value ? 'on' : ''}
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
                if (k !== value) onPick(k);
              }}
            >
              <span className="ck" aria-hidden="true">
                {k === value && <Ic n="check" size={14} />}
              </span>
              <span className="x">
                <b>{l}</b>
                <small>{d}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
