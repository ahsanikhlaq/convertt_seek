'use client';

import { useEffect, useState, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"])';

/** The elements inside `root` that Tab can reach, in page order (visible ones only). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
  );
}

/**
 * Keeps Tab and Shift+Tab inside `ref` while `active`: from the last control Tab goes to the first, and back.
 * Listens on the element itself, so a nested trap (or a pop-up rendered elsewhere) handles its own keys first.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const list = focusables(el);
      if (!list.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const cur = document.activeElement as HTMLElement | null;
      const inside = !!cur && cur !== el && el.contains(cur);
      const go = (to: HTMLElement) => {
        e.preventDefault();
        to.focus();
      };
      if (!inside) return go(e.shiftKey ? last : first);
      if (list.includes(cur!)) {
        if (e.shiftKey && cur === first) go(last);
        else if (!e.shiftKey && cur === last) go(first);
        return;
      }
      // focus is on something Tab can't reach (tabindex=-1): wrap only when nothing follows / precedes it
      const after = list.some((x) => cur!.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
      const before = list.some((x) => cur!.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_PRECEDING);
      if (!e.shiftKey && !after) go(first);
      else if (e.shiftKey && !before) go(last);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref, active]);
}

/** Whether a media query matches (false on the server and on the first render). */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const f = () => setOn(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return on;
}

/** Phone layout (matches the CSS breakpoint). */
export const usePhone = () => useMedia('(max-width:760px)');
