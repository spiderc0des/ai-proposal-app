import 'server-only';
import { supabaseServerClient } from './supabase-server';
import { findAppUser } from './queries';
import type { AppUserRow } from './db-schemas';
import { capabilityLabel, hasCapability } from './permissions';

export { capabilityLabel, canViewProposal, canEditProposal, canEditSectionContent } from './permissions';

/**
 * The one function every route starts with. Two checks, not one:
 *
 *   1. Authentication (Supabase) — is there a valid session at all?
 *   2. Authorisation (our own app_users table) — is this person on the
 *      allowlist, and do they have the capability the action needs?
 *
 * Supabase Auth's default is OPEN SIGNUP: it will create a session for any
 * email address that requests a magic link. Skipping step 2 means anyone
 * with an inbox can use the app — the `app_users` table is the allowlist
 * that actually gates access.
 *
 * Capabilities (is_sales / is_approver / is_admin) are independent flags,
 * not one exclusive role — a person can hold any combination. Approving
 * your own proposal is allowed — the brief asks for a human to verify
 * Claude's output, not specifically a different human than whoever wrote
 * it. is_admin bypasses per-proposal ownership checks
 * (canViewProposal / canEditProposal, in lib/permissions.ts) and always
 * satisfies any capability check here.
 *
 * The actual capability logic lives in lib/permissions.ts, as pure
 * functions with no database or Supabase import — this file re-exports
 * them so every existing `from '@/lib/auth'` import keeps working.
 */
export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function currentUser(): Promise<AppUserRow | null> {
  const supabase = await supabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  return findAppUser(data.user.id);
}

/**
 * A session existing and a session being authorized are different
 * questions — see the comment on requireUser(). This answers only the
 * first one, cheaply, for UI that needs to know whether to show a "sign
 * out" control at all: someone signed in but not on the allowlist still
 * has a session, and is exactly who most needs a visible way to sign out
 * and try a different account.
 */
export async function sessionEmail(): Promise<string | null> {
  const supabase = await supabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.email ?? null;
}

/**
 * @param capability  if given, the caller must have this capability
 *              (is_sales or is_approver — is_admin always satisfies
 *              either). Throws AuthError otherwise — callers in route
 *              handlers turn it into 401/403.
 *
 * Deliberately does NOT call currentUser() — that collapses "no session"
 * and "session but not on the allowlist" into the same null, which used to
 * make requireUser throw the same 401 for both. That produced a real,
 * confusing loop: someone signs in via a working magic link, lands back on
 * a protected page, gets told "sign in to continue" (they just did), and a
 * caller that redirects any AuthError straight back to /login sends them in
 * a circle with no explanation. The two cases are genuinely different and
 * are told apart here:
 *
 *   - 401 no Supabase session at all → the caller should redirect to /login
 *   - 403 has a session, but no app_users row, inactive, or missing the
 *     required capability → the caller must NOT redirect to /login
 *     (they're already signed in); it should show the message, which names
 *     the actual problem.
 */
export async function requireUser(capability?: 'sales' | 'approver'): Promise<AppUserRow> {
  const supabase = await supabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new AuthError(401, 'Sign in to continue.');
  }

  const user = await findAppUser(data.user.id);
  if (!user) {
    throw new AuthError(
      403,
      "You're signed in, but this account isn't on the approved list yet. " +
        'Ask an admin to add you.',
    );
  }
  if (!hasCapability(user, capability)) {
    throw new AuthError(
      403,
      `This action requires the '${capability}' capability. You're signed in as '${capabilityLabel(user)}'.`,
    );
  }
  return user;
}
