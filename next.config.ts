import type { NextConfig } from 'next';

const config: NextConfig = {
  // @react-pdf/renderer and postgres.js are Node-only. Keeping them external
  // stops the bundler trying to pull them into an Edge or client bundle.
  serverExternalPackages: ['@react-pdf/renderer', 'postgres'],
};

export default config;
