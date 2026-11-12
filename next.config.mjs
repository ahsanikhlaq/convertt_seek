// The web build (Vercel) is untouched. The desktop build sets SEEK_DESKTOP=1 to export the
// same pages as static files into desktop/web, which the Electron app serves locally.
const desktop = process.env.SEEK_DESKTOP === '1';

/** @type {import('next').NextConfig} */
const nextConfig = desktop
  ? {
      output: 'export',
      distDir: 'desktop/web',
      trailingSlash: true,
      images: { unoptimized: true },
      // Google won't accept the desktop app's 127.0.0.1 origin, so the desktop build signs in by email
      env: { NEXT_PUBLIC_SEEK_DESKTOP: '1' },
    }
  : {};

export default nextConfig;
