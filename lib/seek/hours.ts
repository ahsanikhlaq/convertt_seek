/* Time and retainer helpers (no imports, so they're easy to test). */

/**
 * Minutes from what someone typed: "1.5", "1,5", "2", "1:30", "1h 30m", "1h", "90m", "45 min", "2 hours 15 minutes".
 * A bare number is hours. Returns null when it can't be read or isn't 1 minute to 24 hours.
 */
export function parseDuration(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  let min: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+(?:\.\d+)?)$/.exec(t))) min = Number(m[1]) * 60;
  else if ((m = /^(\d{1,2}):([0-5]\d)$/.exec(t))) min = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/.exec(t)) && (m[1] || m[2]))
    min = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  if (min == null || !Number.isFinite(min)) return null;
  min = Math.round(min);
  return min >= 1 && min <= 1440 ? min : null;
}

/** "1 h 30 min", "45 min", "2 h". */
export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return m + ' min';
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Hours with at most one decimal: 16.5, 20. */
export const fmtHours = (min: number) => String(Math.round((min / 60) * 10) / 10);

/** The calendar month a date is in, as YYYY-MM-DD bounds [from, to). Local time. */
export function monthRange(d = new Date()): { from: string; to: string; label: string } {
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { from: iso(from), to: iso(to), label: from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
}

/** Today as YYYY-MM-DD (local). */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** How much of the retainer is used: % (rounded down, like the Team notes warning) and its band. */
export function retainerUse(usedMin: number, hours: number | null): { pct: number; band: 'ok' | 'warn' | 'over' } | null {
  if (!hours || hours <= 0) return null;
  const pct = Math.floor((usedMin / 60 / hours) * 100);
  return { pct, band: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok' };
}

/** Hours typed for the retainer ("20", "12.5"): a number from 0.5 to 1000, null for empty (no retainer), NaN if bad. */
export function parseRetainer(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0.5 && n <= 1000 ? Math.round(n * 100) / 100 : NaN;
}
