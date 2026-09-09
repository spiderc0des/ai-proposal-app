import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic', // lib/pdf.tsx uses JSX; tsconfig's "preserve" is for Next's own compiler
  },
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      // See test/stubs/server-only.js — mirrors Next's own bundler aliasing.
      'server-only': path.resolve(__dirname, 'test/stubs/server-only.js'),
    },
  },
});
