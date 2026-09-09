import 'server-only';
import { z } from 'zod';

/**
 * Every setting the app needs, checked once at startup.
 *
 * The point of this file: if a variable is missing, the app refuses to start
 * and NAMES the variable. Without it you get `undefined` thrown from deep
 * inside an API route an hour later, and you debug the wrong thing.
 */
const Schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(10, 'looks too short to be a real key'),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  DATABASE_URL: z.string().startsWith('postgres'),

  APP_URL: z.string().url(),

  // Optional. Without these the app skips sending and logs why, rather than
  // failing the whole delivery. Gmail SMTP, not Resend — see lib/email.ts:
  // Resend's sandbox mode requires a verified domain to send to anyone but
  // the account owner, which is exactly the wall this hit (403
  // validation_error, "koya.com domain is not verified"). Gmail SMTP sends
  // from an address you already own with no domain verification step.
  GMAIL_USER: z.string().email().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  MAIL_FROM_NAME: z.string().default('Koya Talent'),
  DEFAULT_APPROVER_EMAIL: z.string().email().optional().or(z.literal('')),

  MOCK_ANTHROPIC: z.enum(['0', '1']).default('0'),
});

function load() {
  const parsed = Schema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')} — ${i.message}`)
      .join('\n');
    throw new Error(
      `\nThe app cannot start. These environment variables are missing or wrong:\n\n${problems}\n\n` +
        `Copy .env.example to .env.local and fill them in.\n`,
    );
  }
  return parsed.data;
}

export const env = load();

/** True when an email provider is configured. Checked before every send. */
export const emailEnabled = Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);

/** True when Claude calls should be served from recorded fixtures. */
export const mockClaude = env.MOCK_ANTHROPIC === '1';
