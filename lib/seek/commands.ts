/**
 * Slash commands in the composer, and folding sidebar sections.
 *  · Type "/" in a message box (or press the / button) for a menu of commands: start a huddle, catch up, open Tasks,
 *    create a channel, switch theme, go to a screen… Arrow keys move, Enter or Tab runs, Esc closes.
 *  · Clicking the Channels or Direct messages header folds that section (remembered on this device). Unread and
 *    open conversations stay visible.
 * Works on the rendered page (buttons are found by what they say), so every screen gets it without extra wiring.
 * install() returns a function that removes it.
 */

type Target = { click: () => void } | { text: string };
type Command = { g: string; k: string; d: string; t: Target };

const KEY = 'seek:secs';

export function installCommands(): () => void {
  const root = document.documentElement;
  try {
    for (const c of (JSON.parse(localStorage.getItem(KEY) || '[]') as string[]) || []) root.classList.add(c);
  } catch {}

  const setVal = (ta: HTMLTextAreaElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, v);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const find = (sel: string, re: RegExp) => [...document.querySelectorAll<HTMLElement>(sel)].find((b) => re.test((b.textContent || '').trim()));
  const label = (el: Element) => {
    const n = el.firstChild;
    return ((n && n.nodeType === 3 ? n.nodeValue : el.textContent) || '').trim();
  };
  const clicker = (sel: string, re?: RegExp) => () => (re ? find(sel, re) : document.querySelector<HTMLElement>(sel)) ?? null;
  const go = (path: string) => () => ({ click: () => window.dispatchEvent(new CustomEvent('seek:navigate', { detail: path })) });

  const BASE: [string, string, string, () => Target | null][] = [
    ['Here', 'huddle', 'Start a huddle with everyone here', clicker('.main .mh .btn', /^Huddle$/)],
    ['Here', 'call', 'Start a call', clicker('.main .mh .btn', /^Call$/)],
    ['Here', 'catchup', 'Get an AI summary of what you missed', clicker('.main .mh .btn', /^Catch up$/)],
    ['Here', 'members', 'See members and channel settings', clicker('.main .mh .btn', /^Members$/)],
    ['Here', 'notify', 'Change how this channel notifies you', clicker('.main .mh .btn[title^="Normal:"]')],
    ['Here', 'schedule', 'Schedule a call with this client', clicker('.main .mh .btn', /^Schedule$/)],
    ['Workspace', 'tasks', 'Open your tasks', clicker('.side .si', /^Tasks/)],
    ['Workspace', 'saved', 'Open saved messages', clicker('.side .si', /^Saved/)],
    ['Workspace', 'scheduled', 'See messages waiting to send', clicker('.side .si', /^Scheduled/)],
    ['Workspace', 'dm', 'Start a new direct message', clicker('.side .sgadd[data-sec=dm]')],
    ['Workspace', 'channel', 'Create a channel', clicker('.side .sgadd[data-sec=ch]')],
    ['Workspace', 'browse', 'Browse all channels', clicker('.side .si', /^Browse channels$/)],
    ['Workspace', 'invite', 'Invite people to the workspace', clicker('.side .si', /^Invite people$/)],
    ['Workspace', 'search', 'Search messages, people and files', clicker('.tsearch')],
    ['Workspace', 'theme', 'Switch light and dark', clicker('.tmode')],
    ['Go to', 'clients', 'Open client spaces', go('/clients')],
    ['Go to', 'decisions', 'Open the decision log', go('/decisions')],
    ['Go to', 'meetings', 'Open meetings', go('/meetings')],
    ['Go to', 'people', 'Open the people directory', go('/people')],
    ['Text', 'shrug', 'Add ¯\\_(ツ)_/¯ to your message', () => ({ text: '¯\\_(ツ)_/¯' })],
  ];

  const commands = (): Command[] => {
    const out: Command[] = [];
    for (const [g, k, d, f] of BASE) {
      const t = f();
      if (t) out.push({ g, k, d, t });
    }
    // the screen's other tabs (Files, Canvas, Pins…)
    const tabs: Command[] = [];
    document.querySelectorAll<HTMLElement>('.main .tabs .tb:not(.on)').forEach((tb) => {
      const name = label(tb);
      const k = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (k) tabs.push({ g: 'Tabs', k, d: 'Open the ' + name + ' tab', t: tb });
    });
    const i = out.findIndex((c) => c.g !== 'Here');
    out.splice(i < 0 ? out.length : i, 0, ...tabs);
    return out;
  };

  let menu: HTMLDivElement | null = null;
  let items: Command[] = [];
  let sel = 0;
  let cur: HTMLTextAreaElement | null = null;
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  const close = () => {
    menu?.remove();
    menu = null;
    items = [];
    cur = null;
  };

  const refresh = (ta: HTMLTextAreaElement) => {
    const m = /^\/([a-z0-9-]*)$/i.exec(ta.value);
    const comp = ta.closest('.comp');
    if (!m || !comp) return close();
    const q = m[1].toLowerCase();
    let all = commands().filter((c) => c.k.indexOf(q) === 0);
    if (!all.length) all = commands().filter((c) => q && (c.k.indexOf(q) > 0 || c.d.toLowerCase().includes(q)));
    if (!all.length) return close();
    items = all;
    cur = ta;
    if (sel >= items.length) sel = 0;
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'slp';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', 'Commands');
      menu.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const b = (e.target as HTMLElement).closest<HTMLElement>('.sli');
        if (b) {
          sel = Number(b.dataset.i);
          run();
        }
      });
      document.body.appendChild(menu);
    }
    let html = '<div class="sll">';
    let g = '';
    items.forEach((c, i) => {
      if (c.g !== g) {
        g = c.g;
        html += '<div class="slg">' + esc(g) + '</div>';
      }
      html += `<button type="button" role="option" class="sli${i === sel ? ' on' : ''}" aria-selected="${i === sel}" data-i="${i}"><b>/${esc(c.k)}</b><span>${esc(c.d)}</span></button>`;
    });
    html += '</div><div class="slf"><span><kbd>↑</kbd><kbd>↓</kbd>move</span><span><kbd>↵</kbd>run</span><span><kbd>esc</kbd>close</span></div>';
    menu.innerHTML = html;
    const r = comp.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.width = Math.min(460, r.width) + 'px';
    menu.style.bottom = window.innerHeight - r.top + 8 + 'px';
    menu.querySelector('.sli.on')?.scrollIntoView?.({ block: 'nearest' });
  };

  const run = () => {
    const c = items[sel];
    const ta = cur;
    if (!c || !ta) return;
    close();
    if ('text' in c.t) {
      setVal(ta, c.t.text + ' ');
      ta.focus();
      return;
    }
    setVal(ta, '');
    const t = c.t;
    setTimeout(() => t.click(), 0);
  };

  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const h = el.closest?.<HTMLElement>('.sgb[data-sec]');
    if (h) {
      root.classList.toggle('sec-' + h.dataset.sec + '-closed');
      try {
        localStorage.setItem(KEY, JSON.stringify([...root.classList].filter((c) => /^sec-.*-closed$/.test(c))));
      } catch {}
      return;
    }
    const sb = el.closest?.('.slashb');
    if (sb) {
      const ta = sb.closest('.comp')?.querySelector('textarea');
      if (ta) {
        ta.focus();
        if (!ta.value) setVal(ta, '/');
        else refresh(ta);
      }
    }
  };
  const onInput = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t?.tagName === 'TEXTAREA' && t.closest('.comp')) {
      sel = 0;
      refresh(t as HTMLTextAreaElement);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (!menu || !cur) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      sel = (sel + (k === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      refresh(cur);
    } else if (k === 'Enter' || k === 'Tab') run();
    else if (k === 'Escape') close();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onBlur = (e: FocusEvent) => {
    if (menu && e.target === cur) setTimeout(() => document.activeElement !== cur && close(), 150);
  };

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput, true);
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('focusout', onBlur);
  window.addEventListener('hashchange', close);
  window.addEventListener('popstate', close);
  window.addEventListener('resize', close);
  return () => {
    close();
    document.removeEventListener('click', onClick);
    document.removeEventListener('input', onInput, true);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusout', onBlur);
    window.removeEventListener('hashchange', close);
    window.removeEventListener('popstate', close);
    window.removeEventListener('resize', close);
  };
}
