#!/usr/bin/env node
/**
 * Prints a working sign-in link WITHOUT sending an email at all.
 *
 * Use this when Supabase's mailer is rate-limited and you don't have a
 * custom domain to verify with Resend (Resend's own unverified sandbox mode
 * can only deliver to the address on your Resend account, which doesn't
 * help when you need two different people — sales and approver — signed in
 * to test the approval gate).
 *
 * This calls the Admin API's generateLink(), which creates the same token a
 * magic-link email would carry, but hands it back as a string instead of
 * emailing it. No mailer involved, no rate limit, no domain needed.
 *
 * DEV ONLY. This uses the service-role key to mint a session for ANY email —
 * it must never be exposed as an app route or run against production data
 * without that in mind.
 *
 * Usage:
 *   node scripts/magic-link.mjs you@example.com
 *   node scripts/magic-link.mjs approver@example.com
 */
import { createClient } from '@supabase/supabase-js';

// Node's native .env loader (22+) — no extra dependency needed.
try {
  process.loadEnvFile('.env.local');
} catch {
  console.error('Could not find .env.local in the current directory. Run this from the project root.');
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/magic-link.mjs <email>');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.APP_URL || 'http://localhost:3000';

if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const admin = createClient(url, serviceKey);

const { data, error } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo: `${appUrl}/auth/callback` },
});

if (error) {
  console.error('Failed:', error.message);
  process.exit(1);
}

console.log(`\nSign-in link for ${email} (no email sent — open this directly):\n`);
console.log(data.properties.action_link);
console.log('\nThis token is single-use and expires quickly — use it right away.\n');
