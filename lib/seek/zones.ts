/**
 * Time zones for profiles and workspaces. They are saved as a label such as "Karachi (GMT+5)" or
 * "Kolkata (GMT+5:30)" (offsetOf / placeOf in liveMeetings.ts read those), and offered from the browser's own full
 * list (Intl.supportedValuesOf), with this computer's zone first.
 */

const FALLBACK = ['Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'UTC'];

/** Minutes the zone is ahead of UTC right now (0 when the browser doesn't know it). */
export function zoneOffsetMin(tz: string, at = new Date()): number {
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(at)
        .map((x) => [x.type, x.value]),
    );
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((wall - at.getTime()) / 60000);
  } catch {
    return 0;
  }
}

/** "GMT+5", "GMT+5:30", "GMT-4", "GMT+0". */
export function gmtOf(min: number) {
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return 'GMT' + (min < 0 ? '-' : '+') + h + (m ? ':' + String(m).padStart(2, '0') : '');
}

const cityOf = (tz: string) => (tz === 'UTC' ? 'UTC' : (tz.split('/').pop() ?? tz).replace(/_/g, ' '));

/** The saved label for an IANA zone: "Karachi (GMT+5)". */
export const zoneLabel = (tz: string) => `${cityOf(tz)} (${gmtOf(zoneOffsetMin(tz))})`;

/** This computer's time zone name, e.g. "Asia/Karachi" ('UTC' when unknown). */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** This computer's zone as a saved label, e.g. "Karachi (GMT+5)". */
export const guessZoneLabel = () => zoneLabel(browserZone());

export type ZoneOption = { value: string; text: string; group: string; offset: number };
let memo: ZoneOption[] | null = null;
/** Every zone the browser knows, grouped by region and sorted by city, one option per label. */
export function zoneOptions(): ZoneOption[] {
  if (memo) return memo;
  let all: string[];
  try {
    all = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    all = FALLBACK;
  }
  if (!all.includes('UTC')) all = [...all, 'UTC'];
  const seen = new Set<string>();
  const out: ZoneOption[] = [];
  for (const tz of all) {
    const value = zoneLabel(tz);
    if (seen.has(value)) continue;
    seen.add(value);
    const parts = tz.split('/');
    const group = parts.length > 1 ? parts[0].replace(/_/g, ' ') : 'Other';
    const region = parts.length > 2 ? ' · ' + parts.slice(1, -1).join(' / ').replace(/_/g, ' ') : '';
    const offset = zoneOffsetMin(tz);
    out.push({ value, text: `${cityOf(tz)}${region} · ${gmtOf(offset)}`, group, offset });
  }
  out.sort((a, b) => a.group.localeCompare(b.group) || a.text.localeCompare(b.text));
  memo = out;
  return out;
}
