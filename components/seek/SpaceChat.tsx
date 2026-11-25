'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClientTab } from '@/lib/seek/data';
import { Ic } from './icons';

/**
 * How a client space's tabs fit on wider screens: 1 always shows, 2 moves under More when the column is narrow,
 * 3 lives under More (the open tab always shows). Phones show them all in a strip that scrolls.
 */
const TAB_TIER: Record<string, 1 | 2 | 3> = { 'Client chat': 1, 'Team notes': 1, Approvals: 1, Status: 2, Files: 2, 'Scope & hours': 3, Pins: 3, People: 3 };
const tierOf = (t: string) => TAB_TIER[t] ?? 2;

/** A client space's tabs: the main ones in a row, the rest under "More". */
export function SpaceTabs({ tabs, tab, setTab, badge }: { tabs: ClientTab[]; tab: ClientTab; setTab: (t: ClientTab) => void; badge?: (t: ClientTab) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  // the menu items that are showing (which ones depends on the column's width)
  const items = () => Array.from(wrap.current?.querySelectorAll<HTMLElement>('.tmenu [role=menuitemradio]') ?? []).filter((x) => x.offsetParent !== null);
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.querySelector('.tmenu')?.contains(t) && !moreBtn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  /** Arrow keys, Home and End move through the menu; Escape and Tab close it, back to More. */
  const keys = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      moreBtn.current?.focus();
    }
  };
  const pick = (t: ClientTab) => {
    setTab(t);
    setOpen(false);
  };
  return (
    <div className="stabs" ref={wrap}>
      <div className="tabs" role="tablist" aria-label="Client space">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={'tb t' + tierOf(t) + (tab === t ? ' on' : '') + (t === 'Client chat' ? ' gold' : '')}
            onClick={() => setTab(t)}
          >
            {t}
            {badge?.(t)}
          </button>
        ))}
      </div>
      {tabs.some((t) => tierOf(t) > 1) && (
        <div className="tmore-w">
          <button ref={moreBtn} type="button" className={'tb tmore' + (open ? ' open' : '')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            More <Ic n="caret" size={14} />
          </button>
          {open && (
            <div className="tmenu" role="menu" aria-label="More tabs" onKeyDown={keys}>
              {tabs.map((t) => (
                <button key={t} type="button" role="menuitemradio" aria-checked={tab === t} className={'t' + tierOf(t) + (tab === t ? ' on' : '')} onClick={() => pick(t)}>
                  <span>{t}</span>
                  {badge?.(t)}
                  {tab === t && <Ic n="check" size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A slim, dismissible note at the top of a conversation; once closed it stays closed for that space (this device). */
export function SpaceHint({ id, tone, icon, children }: { id: string; tone: 'gold' | 'v'; icon: 'eye' | 'lock'; children: React.ReactNode }) {
  const key = 'seek:hint:' + id;
  // hidden until we know it wasn't dismissed, so a closed note never flashes
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let gone = false;
    try {
      gone = localStorage.getItem(key) === '1';
    } catch {}
    setHidden(gone);
  }, [key]);
  if (hidden) return null;
  return (
    <div className={'hint ' + tone} role="note">
      <Ic n={icon} size={13} />
      <span>{children}</span>
      <button
        type="button"
        className="hint-x"
        aria-label="Dismiss this note"
        title="Dismiss"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(key, '1');
          } catch {}
        }}
      >
        <Ic n="close" size={14} />
      </button>
    </div>
  );
}
