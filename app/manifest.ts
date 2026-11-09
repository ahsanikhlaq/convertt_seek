import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Seek by Convertt',
    short_name: 'Seek',
    description: 'Team chat with client spaces, decisions, meetings, AI agents and apps.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8f3ea',
    theme_color: '#3f0e40',
    icons: [{ src: '/icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' }],
  };
}
