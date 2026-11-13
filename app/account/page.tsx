import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccountPage } from '@/components/seek/pages/AccountPage';

export const metadata: Metadata = { title: 'Account settings' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccountPage />
    </Suspense>
  );
}
