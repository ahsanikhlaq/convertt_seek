/** Every screen in the app has its own URL. */
export const ROUTES = {
  signup: '/signup',
  setup: '/setup',
  welcome: '/welcome',
  join: '/join',
  privacy: '/privacy',
  terms: '/terms',
  channels: '/channels',
  dms: '/dms',
  clients: '/clients',
  meetings: '/meetings',
  invite: '/invite',
  decisions: '/decisions',
  agents: '/agents',
  apps: '/apps',
  open: '/open',
} as const;

export type RouteKey = keyof typeof ROUTES;

/** Normalises a pathname (with or without trailing slash) to a route key. */
export function routeOf(pathname: string | null): RouteKey | null {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  const hit = (Object.entries(ROUTES) as [RouteKey, string][]).find(([, v]) => v === p);
  return hit ? hit[0] : null;
}

/**
 * The product prototype names screens by hash (`#client`, `#schedule`, …). These map its names to ours,
 * so prototype links and its review page (which sends `seekGo` and listens for `seekRoute`) still work.
 */
const PROTOTYPE: Record<string, RouteKey> = {
  signup: 'signup',
  setup: 'setup',
  channels: 'channels',
  dms: 'dms',
  invite: 'invite',
  client: 'clients',
  schedule: 'meetings',
  decisions: 'decisions',
  agents: 'agents',
  apps: 'apps',
};

/** A prototype screen name (or one of ours) to a route key; null if unknown. */
export function routeFromPrototype(name: string | null | undefined): RouteKey | null {
  const n = (name || '').replace(/^#/, '');
  if (n in PROTOTYPE) return PROTOTYPE[n];
  return n in ROUTES ? (n as RouteKey) : null;
}

/** Our route key to the prototype's screen name. */
export function prototypeName(r: RouteKey): string {
  return Object.keys(PROTOTYPE).find((k) => PROTOTYPE[k] === r) || r;
}
