import { redirect } from 'next/navigation';
import { sessionEmail } from '@/lib/auth';

/**
 * There is no "home page" content of its own — `/` exists only to send
 * someone to the right place, mirroring the same rule the nav logo already
 * follows (app/layout.tsx): signed in → the proposals list (their actual
 * work), signed out → the sign-in page. Landing straight on the intake
 * form (`/new`) instead would skip past everything already in progress.
 */
export default async function HomePage() {
  const email = await sessionEmail();
  redirect(email ? '/proposals' : '/login');
}
