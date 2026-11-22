import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // postgres.js is a Node library; keep it out of the bundler.
  serverExternalPackages: ['postgres'],
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];
    return [
      // The chat widget must be embeddable in any salon's website.
      { source: '/embed', headers: [...common, { key: 'Content-Security-Policy', value: 'frame-ancestors *' }] },
      // Everything else (dashboard, login...) must never be framed.
      { source: '/((?!embed).*)', headers: [...common, { key: 'X-Frame-Options', value: 'DENY' }] },
      { source: '/widget.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }] },
    ];
  },
};

export default nextConfig;
