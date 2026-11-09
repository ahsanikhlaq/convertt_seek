// The web build (Vercel) is untouched. The desktop build sets SEEK_DESKTOP=1 to export the
// same pages as static files into desktop/web, which the Electron app serves locally.
const desktop = process.env.SEEK_DESKTOP === '1';

/** @type {import('next').NextConfig} */
const nextConfig = desktop
  ? { output: 'export', distDir: 'desktop/web', trailingSlash: true, images: { unoptimized: true } }
  : {};

export default nextConfig;
