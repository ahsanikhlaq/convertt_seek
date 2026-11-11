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
