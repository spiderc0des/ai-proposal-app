import { NextRequest, NextResponse } from 'next/server';
import { supabaseServerClient } from '@/lib/supabase-server';

/**
 * The escape hatch for "I signed in with the wrong account." Without this,
 * someone stuck on a not-authorized screen has no way back to /login short
 * of manually clearing cookies.
 */
export async function POST(request: NextRequest) {
  const supabase = await supabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url));
}
