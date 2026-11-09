/** Every screen in the app has its own URL. */
export const ROUTES = {
  signup: '/signup',
  setup: '/setup',
  channels: '/channels',
  dms: '/dms',
  clients: '/clients',
  meetings: '/meetings',
  invite: '/invite',
  decisions: '/decisions',
  agents: '/agents',
  apps: '/apps',
} as const;

export type RouteKey = keyof typeof ROUTES;

/** Normalises a pathname (with or without trailing slash) to a route key. */
export function routeOf(pathname: string | null): RouteKey | null {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  const hit = (Object.entries(ROUTES) as [RouteKey, string][]).find(([, v]) => v === p);
  return hit ? hit[0] : null;
}
