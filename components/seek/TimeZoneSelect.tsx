'use client';

import { useMemo, useState } from 'react';
import { guessZoneLabel, zoneOptions } from '@/lib/seek/zones';

/**
 * Pick any time zone: a box to search by city, region or GMT offset, and the list (this computer's zone first, then
 * every zone by region). The value is a saved label such as "Karachi (GMT+5)".
 */
export function TimeZoneSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState('');
  const mine = useMemo(() => guessZoneLabel(), []);
  const all = useMemo(() => zoneOptions(), []);
  const needle = q.trim().toLowerCase();
  const list = needle ? all.filter((z) => (z.text + ' ' + z.group).toLowerCase().includes(needle) || z.value.toLowerCase().includes(needle)) : all;
  const groups = useMemo(() => {
    const m = new Map<string, typeof list>();
    for (const z of list) m.set(z.group, [...(m.get(z.group) ?? []), z]);
    return [...m];
  }, [list]);
  // a saved zone from before (e.g. "Lahore (GMT+5)") stays selectable
  const known = all.some((z) => z.value === value);
  return (
    <div className="tzpick">
      <input
        className="inp"
        type="search"
        aria-label="Search time zones"
        aria-controls={id}
        placeholder="Search a city or GMT+5…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          const v = e.target.value.trim().toLowerCase();
          // the first match is chosen as you type, so search + Enter is enough
          const first = v ? all.find((z) => (z.text + ' ' + z.group).toLowerCase().includes(v)) : null;
          if (first) onChange(first.value);
        }}
      />
      <select id={id} className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known && value && <option value={value}>{value}</option>}
        {!needle && (
          <optgroup label="Your time zone">
            <option value={mine}>{mine}</option>
          </optgroup>
        )}
        {groups.map(([g, zs]) => (
          <optgroup key={g} label={g}>
            {zs
              .filter((z) => needle || z.value !== mine)
              .map((z) => (
                <option key={z.value} value={z.value}>
                  {z.text}
                </option>
              ))}
          </optgroup>
        ))}
        {needle && !list.length && <option disabled>No time zone matches “{q.trim()}”</option>}
      </select>
    </div>
  );
}
