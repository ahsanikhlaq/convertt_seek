'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EMOJI, THEMES, DEFAULT_THEME, type Theme } from '@/lib/seek/data';
import { useSeek } from '@/lib/seek/store';
import { Emoji, ModeSeg } from './ui';
import { PromptDialog, ConfirmDialog } from './Dialogs';

type EmojiReq = { anchor: HTMLElement; onPick: (k: string) => void };

type Ctx = {
  openEmoji: (anchor: HTMLElement, onPick: (k: string) => void) => void;
  toggleTheme: (anchor: HTMLElement) => void;
  closeAll: () => void;
};
const PopCtx = createContext<Ctx | null>(null);

export function usePopovers() {
  const c = useContext(PopCtx);
  if (!c) throw new Error('usePopovers must be used inside <PopoverProvider>');
  return c;
}

/** Keeps a fixed-position popover next to its anchor and inside the window. */
function usePlace(anchor: HTMLElement | null, box: React.RefObject<HTMLDivElement | null>, prefer: 'above' | 'below') {
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !box.current) return;
    const a = anchor.getBoundingClientRect();
    const width = Math.min(340, innerWidth - 16);
    const left = Math.max(8, Math.min(a.left, innerWidth - width - 8));
    const h = Math.min(box.current.offsetHeight, innerHeight - 16);
    let top: number;
    if (prefer === 'above') top = a.top - h - 8 > 8 ? a.top - h - 8 : Math.min(a.bottom + 8, innerHeight - h - 8);
    else top = Math.max(8, Math.min(a.bottom + 8, innerHeight - h - 8));
    setPos({ left, top, width });
  }, [anchor, box, prefer]);
  return pos;
}

export function PopoverProvider({ children }: { children: React.ReactNode }) {
  const [emoji, setEmoji] = useState<EmojiReq | null>(null);
  const [theme, setTheme] = useState<HTMLElement | null>(null);

  const openEmoji = useCallback((anchor: HTMLElement, onPick: (k: string) => void) => {
    setTheme(null);
    setEmoji((cur) => (cur && cur.anchor === anchor ? null : { anchor, onPick }));
  }, []);
  const toggleTheme = useCallback((anchor: HTMLElement) => {
    setEmoji(null);
    setTheme((cur) => (cur ? null : anchor));
  }, []);
  const closeAll = useCallback(() => {
    setEmoji(null);
    setTheme(null);
  }, []);

  useEffect(() => {
    const onResize = () => setEmoji(null);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  return (
    <PopCtx.Provider value={{ openEmoji, toggleTheme, closeAll }}>
      {children}
      {emoji && <EmojiPicker req={emoji} onClose={() => setEmoji(null)} />}
      {theme && <ThemePopover anchor={theme} onClose={() => setTheme(null)} />}
    </PopCtx.Provider>
  );
}

function useOutside(ref: React.RefObject<HTMLElement | null>, anchor: HTMLElement, onClose: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      // dialogs opened from inside the popover keep it open
      if ((t as HTMLElement).closest?.('.scrim')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, anchor, onClose]);
}

/* ---------------- emoji picker ---------------- */

const CAT_ICON: Record<string, string> = { Recent: '🕘', Smileys: '😀', Gestures: '👍', Work: '✅', Fun: '🎉', Custom: '★' };

function EmojiPicker({ req, onClose }: { req: EmojiReq; onClose: () => void }) {
  const { s, update, toast } = useSeek();
  const [cat, setCat] = useState('Smileys');
  const [q, setQ] = useState('');
  const [naming, setNaming] = useState<{ src: string; suggested: string } | null>(null);
  const [clearing, setClearing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pos = usePlace(req.anchor, ref, 'above');
  useOutside(ref, req.anchor, onClose);

  const cats = ['Recent', ...Object.keys(EMOJI), 'Custom'];
  const customItems = s.custom.map((c) => ({ k: ':' + c.n + ':', t: c.n }));
  let items: { k: string; t: string }[];
  if (q) {
    const ql = q.toLowerCase();
    items = Object.values(EMOJI)
      .flat()
      .map((e) => ({ k: e, t: e }))
      .concat(customItems)
      .filter((x) => x.t.toLowerCase().includes(ql) || x.k.includes(ql));
  } else if (cat === 'Custom') items = customItems;
  else if (cat === 'Recent') items = s.recentE.map((e) => ({ k: e, t: e }));
  else items = EMOJI[cat].map((e) => ({ k: e, t: e }));

  const pick = (k: string) => {
    update((d) => {
      d.recentE = [k, ...d.recentE.filter((x) => x !== k)].slice(0, 24);
    });
    req.onPick(k);
    onClose();
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 64;
        const x = cv.getContext('2d')!;
        const sz = Math.min(img.width, img.height);
        x.drawImage(img, (img.width - sz) / 2, (img.height - sz) / 2, sz, sz, 0, 0, 64, 64);
        setNaming({ src: cv.toDataURL('image/png'), suggested: f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') });
      };
      img.src = r.result as string;
    };
    r.readAsDataURL(f);
  };

  return (
    <>
      <div
        ref={ref}
        className="emp"
        role="dialog"
        aria-label="Emoji picker"
        style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden', left: 0, top: 0, width: 340 }}
      >
        <div className="emh">
          <input className="inp" placeholder="Search emoji and icons" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="emt" role="tablist">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={cat === c && !q}
              className={cat === c && !q ? 'on' : ''}
              onClick={() => {
                setCat(c);
                setQ('');
              }}
            >
              {CAT_ICON[c]}
              <span>{c}</span>
            </button>
          ))}
        </div>
        <div className="emg">
          {items.length ? (
            items.map((x) => (
              <button key={x.k} type="button" title={x.t} onClick={() => pick(x.k)}>
                <Emoji k={x.k} large />
              </button>
            ))
          ) : (
            <div className="empty" style={{ gridColumn: '1/-1', padding: 18 }}>
              {cat === 'Custom' ? 'No custom icons yet. Upload your own below.' : 'Nothing here yet.'}
            </div>
          )}
        </div>
        <div className="emf">
          <label className="btn sm">
            <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />⬆ Add your emoji / icon
          </label>
          {cat === 'Custom' && s.custom.length > 0 && (
            <button type="button" className="btn sm ghost danger" onClick={() => setClearing(true)}>
              Clear custom
            </button>
          )}
        </div>
      </div>
      {naming && (
        <PromptDialog
          title="Name your emoji"
          label="Letters, numbers, - or _"
          initial={naming.suggested}
          confirm="Add emoji"
          onCancel={() => setNaming(null)}
          onSubmit={(v) => {
            const n = v.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
            if (!n) return;
            update((d) => {
              d.custom = d.custom.filter((c) => c.n !== n).concat([{ n, src: naming.src }]);
            });
            setNaming(null);
            setCat('Custom');
            setQ('');
            toast('Added :' + n + ': to your emoji');
          }}
        />
      )}
      {clearing && (
        <ConfirmDialog
          title="Remove all custom emoji?"
          body="Messages that use them will show the :name: instead."
          confirm="Remove all"
          danger
          onCancel={() => setClearing(false)}
          onConfirm={() => {
            update((d) => {
              d.custom = [];
            });
            setClearing(false);
          }}
        />
      )}
    </>
  );
}

/* ---------------- theme & branding ---------------- */

function ThemePopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const { s, update, toast } = useSeek();
  const ref = useRef<HTMLDivElement>(null);
  const pos = usePlace(anchor, ref, 'below');
  useOutside(ref, anchor, onClose);
  const t = s.theme;
  const set = (k: keyof Theme, v: string) =>
    update((d) => {
      d.theme = { ...d.theme, [k]: v };
    });

  const sec = (k: keyof Theme, title: string, sub: string) => (
    <div className="bsec">
      <div className="bst">
        <b>{title}</b>
        <small>{sub}</small>
      </div>
      <div className="bpg">
        {THEMES[k].map(([n, h]) => (
          <button key={h} type="button" className={t[k] === h ? 'on' : ''} aria-pressed={t[k] === h} onClick={() => set(k, h)}>
            <span style={{ background: h }}></span>
            <em>{n}</em>
          </button>
        ))}
      </div>
      <label className="bpc">
        Custom <input type="color" value={t[k]} onChange={(e) => set(k, e.target.value)} />
        <code>{t[k]}</code>
      </label>
    </div>
  );

  return (
    <div
      ref={ref}
      className="bpop"
      role="dialog"
      aria-label="Theme and branding"
      style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden', left: 0, top: 0, width: 340 }}
    >
      <div className="bph">
        <b>Theme & branding</b>
        <small>Sidebar, page and accent colours</small>
      </div>
      <div style={{ padding: '0 14px 10px' }}>
        <ModeSeg />
      </div>
      <div className="bprev">
        <span style={{ background: t.side }}>
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span style={{ background: t.body }}>
          <i style={{ background: t.acc }}></i>
          <i></i>
        </span>
      </div>
      <div className="bscroll">
        {sec('side', 'Sidebar', 'Left bar and channel list')}
        {sec('body', 'Page', 'Background behind your content')}
        {sec('acc', 'Accent', 'Buttons, highlights and links')}
      </div>
      <div className="bpf">
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => {
            update((d) => {
              d.theme = DEFAULT_THEME;
            });
            onClose();
            toast('Theme reset');
          }}
        >
          Reset
        </button>
        <button
          type="button"
          className="btn sm pri"
          onClick={() => {
            onClose();
            toast('Theme saved');
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
