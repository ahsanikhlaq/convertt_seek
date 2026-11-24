import type { Metadata } from 'next';
import { SignInPage } from '@/components/seek/pages/AuthPages';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page() {
  return <SignInPage />;
}
