import type { Theme } from './data';

/** Mixes a hex colour toward white ('w') or black ('b') by k (0–1). */
export function hexMix(h: string, k: number, to: 'w' | 'b'): string {
  const a = parseInt(h.slice(1), 16);
  const r = a >> 16, g = (a >> 8) & 255, b = a & 255, t = to === 'w' ? 255 : 0;
  const mx = (v: number) => Math.round(v + (t - v) * k).toString(16).padStart(2, '0');
  return '#' + mx(r) + mx(g) + mx(b);
}

export function lum(h: string): number {
  const a = parseInt(h.slice(1), 16);
  return (0.299 * (a >> 16) + 0.587 * ((a >> 8) & 255) + 0.114 * (a & 255)) / 255;
}

/** Writes the theme's colour tokens onto <html> and toggles dark mode. */
export function applyTheme(t: Theme, dark: boolean) {
  const root = document.documentElement;
  const R = root.style;
  const set = (k: string, v: string) => R.setProperty(k, v);
  const { side: sb, body: bd, acc: ac } = t;
  const light = lum(sb) > 0.6;

  set('--sbg', sb);
  set('--rbg', light ? hexMix(sb, 0.06, 'b') : hexMix(sb, 0.25, 'b'));
  set('--sfg', light ? '#2a1a2a' : '#f3e9f3');
  set('--sfg2', light ? '#6b566b' : 'rgba(243,233,243,.66)');
  set('--shov', light ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.08)');
  set('--son', light ? hexMix(ac, 0.82, 'w') : hexMix(ac, 0.15, 'w'));
  set('--sonfg', light ? hexMix(ac, 0.2, 'b') : '#fff');
  set('--sln', light ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.1)');

  root.classList.toggle('dark', dark);
  if (dark) {
    set('--body', '#1a1d21'); set('--card', '#222529'); set('--bg', '#27292e'); set('--soft', '#2c2f34');
    set('--ln', '#383b40'); set('--ln2', '#4b4e54'); set('--ink', '#e8e8ea'); set('--mu', '#b9bbbf'); set('--sb', '#9a9ea4'); // lighter than before so small grey text passes 4.5:1
    if (!light) {
      set('--sbg', hexMix(sb, 0.45, 'b'));
      set('--rbg', hexMix(sb, 0.62, 'b'));
    } else {
      set('--sbg', '#19171d'); set('--rbg', '#121016'); set('--sfg', '#e8e8ea'); set('--sfg2', 'rgba(232,232,234,.62)');
      set('--shov', 'rgba(255,255,255,.07)'); set('--sln', 'rgba(255,255,255,.1)'); set('--son', hexMix(ac, 0.1, 'w')); set('--sonfg', '#fff');
    }
  } else {
    set('--body', bd); set('--card', hexMix(bd, 0.55, 'w')); set('--bg', hexMix(bd, 0.25, 'w'));
    set('--soft', hexMix(bd, 0.05, 'b')); set('--ln', hexMix(bd, 0.1, 'b')); set('--ln2', hexMix(bd, 0.18, 'b'));
    ['--ink', '--mu', '--sb'].forEach((v) => R.removeProperty(v));
  }

  // accent
  set('--v', ac);
  set('--vd', dark ? hexMix(ac, 0.55, 'w') : hexMix(ac, 0.28, 'b'));
  set('--vs', dark ? hexMix(ac, 0.62, 'b') : hexMix(ac, 0.88, 'w'));
  set('--rail', hexMix(ac, 0.9, 'w'));
  set('--railln', hexMix(ac, 0.78, 'w'));
}
