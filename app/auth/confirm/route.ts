import { NextRequest, NextResponse } from 'next/server';
import { supabaseServerClient } from '@/lib/supabase-server';
import { ensurePendingAppUser } from '@/lib/queries';

/**
 * Where an invitation link lands (built by /api/admin/invites).
 *
 * A sibling of app/auth/callback, not a replacement: that route completes a
 * PKCE sign-in from /login by exchanging a `code`. An admin-generated link
 * carries a `token_hash` instead, which is verified here with verifyOtp().
 * Both end the same way — a session cookie, then ensurePendingAppUser().
 *
 * For an invited person that last call does not create anything: their row
 * already exists, with the capabilities the admin chose. It only stamps
 * first_signed_in_at, which is how the admin page tells "accepted, waiting
 * for activation" apart from "never clicked the link".
 *
 * They land on /profile, not /new, because they cannot use the app yet —
 * and /profile is the page that says why, in plain words, instead of an
 * access-denied screen on their first visit.
 */
const ALLOWED_TYPES = new Set(['invite', 'magiclink']);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');

  const fail = (reason: string) => {
    const url = new URL('/login', request.url);
    url.searchParams.set('error', reason);
    return NextResponse.redirect(url);
  };

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) return fail('invalid_link');

  const supabase = await supabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as 'invite' | 'magiclink',
  });

  // Expired and already-used look identical to the person holding the link,
  // and the remedy is the same for both — ask for a new invite.
  if (error || !data.user?.email) return fail('link_expired');

  await ensurePendingAppUser(data.user.id, data.user.email);
  return NextResponse.redirect(new URL('/profile?welcome=1', request.url));
}
