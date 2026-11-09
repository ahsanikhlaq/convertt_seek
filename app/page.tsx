'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';

/** Opens the right screen for where this person is: sign-up, setup or their channels. */
export default function Home() {
  const { s } = useSeek();
  const router = useRouter();
  useEffect(() => {
    router.replace(s.session === 'in' ? ROUTES.channels : s.session === 'setup' ? ROUTES.setup : ROUTES.signup);
  }, [s.session, router]);
  return null;
}
