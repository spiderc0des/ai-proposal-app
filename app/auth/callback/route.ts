import { NextRequest, NextResponse } from 'next/server';
import { supabaseServerClient } from '@/lib/supabase-server';
import { ensurePendingAppUser } from '@/lib/queries';

/**
 * Where a magic link actually lands: exchanges the code for a session
 * cookie, then makes sure this person has a row in app_users — created
 * PENDING (active = false) if this is their first time. See
 * lib/queries.ts ensurePendingAppUser() for why that's safe to do on every
 * sign-in, not just the first.
 *
 * A pending row grants nothing by itself — findAppUser() (lib/queries.ts)
 * only matches active = true, so requireUser() still 403s until an admin
 * flips that flag. This step only removes the "someone has to manually copy
 * a UUID out of the Supabase dashboard before a new person can even be
 * considered" friction — it does not weaken the allowlist itself.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    const supabase = await supabaseServerClient();
    const { data } = await supabase.auth.exchangeCodeForSession(code);
    if (data.user?.email) {
      await ensurePendingAppUser(data.user.id, data.user.email);
    }
  }
  return NextResponse.redirect(new URL('/new', request.url));
}
