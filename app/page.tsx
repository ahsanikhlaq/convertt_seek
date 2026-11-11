'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ROUTES, routeFromPrototype } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';

/**
 * Opens the screen a prototype link names (/#client, /#schedule, …), otherwise the right one for where
 * this person is: sign-up, setup or their channels. Decides once, so a later state change can't overrule it.
 */
export default function Home() {
  const { s } = useSeek();
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const linked = routeFromPrototype(location.hash);
    const home = { in: ROUTES.channels, setup: ROUTES.setup, profile: ROUTES.welcome, out: ROUTES.signup, client: ROUTES.clients }[s.session];
    router.replace(linked ? ROUTES[linked] : home);
  }, [s.session, router]);
  return null;
}
