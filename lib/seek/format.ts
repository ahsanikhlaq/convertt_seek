export const now = () => {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

export const isEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v);

/** "Momna Khan" → "MK", "ahsan.dev" → "AD". */
export const initialsOf = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export const slugify = (v: string) => (v || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'workspace';

export const channelId = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * Meeting messages written by older servers say the time in UTC ("Meeting: Kickoff · Thu 26 Nov 05:00 UTC"); this
 * shows that time on this computer's clock instead, like the meeting card does. `near` is when the message was
 * written (it fixes the year). Any other text comes back unchanged.
 */
export function localMeetingText(text: string, near?: string): string {
  if (!/\b(Meeting|Cancelled): /.test(text) || !/ UTC\)?$/.test(text)) return text;
  return text.replace(/\b[A-Z][a-z]{2} (\d{1,2}) ([A-Z][a-z]{2}) (\d{2}):(\d{2}) UTC\b/, (all, dd: string, mon: string, hh: string, mi: string) => {
    const m = MONTHS.indexOf(mon);
    if (m < 0) return all;
    const base = near ? new Date(near) : new Date();
    const y = Number.isNaN(base.getTime()) ? new Date().getUTCFullYear() : base.getUTCFullYear();
    let at = new Date(Date.UTC(y, m, +dd, +hh, +mi));
    // a meeting in January booked in December is next year's
    if (at.getTime() < base.getTime() - 60 * 864e5) at = new Date(Date.UTC(y + 1, m, +dd, +hh, +mi));
    const pad = (n: number) => String(n).padStart(2, '0');
    return at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes()) + ' your time';
  });
}
