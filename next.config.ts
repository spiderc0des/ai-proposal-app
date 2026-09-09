import type { NextConfig } from 'next';

const config: NextConfig = {
  // @react-pdf/renderer and postgres.js are Node-only. Keeping them external
  // stops the bundler trying to pull them into an Edge or client bundle.
  serverExternalPackages: ['@react-pdf/renderer', 'postgres'],
  // pdfkit (a dependency of @react-pdf/renderer) loads its standard-font
  // metric files with a runtime `require(\`./standard-fonts/${name}.cjs\`)` —
  // the font name is a variable, not a string literal, so Vercel's static
  // output-file tracing can't see which files that resolves to and leaves
  // them out of the deployed function. Result: PDF rendering works locally
  // (the full node_modules tree is on disk) but throws `Cannot find module
  // '.../pdfkit/js/standard-fonts/Helvetica.cjs'` in production. Forcing
  // the whole directory into both routes that render a PDF fixes it.
  outputFileTracingIncludes: {
    '/p/share/[token]/pdf': ['./node_modules/pdfkit/js/standard-fonts/**/*'],
    '/api/proposals/[id]/send': ['./node_modules/pdfkit/js/standard-fonts/**/*'],
  },
};

export default config;
