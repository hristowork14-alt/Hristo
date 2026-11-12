import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // postgres.js is a Node library; keep it out of the bundler.
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
