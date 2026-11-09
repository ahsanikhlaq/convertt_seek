import type { Metadata } from 'next';
import { SignupPage } from '@/components/seek/pages/AuthPages';

export const metadata: Metadata = { title: 'Create your account' };

export default function Page() {
  return <SignupPage />;
}
