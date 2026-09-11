import { redirect } from 'next/navigation';
import { requireUser, AuthError } from '@/lib/auth';
import IntakeForm from './IntakeForm';
import NotAuthorized from '../NotAuthorized';

export default async function NewProposalPage() {
  let user;
  try {
    user = await requireUser('sales');
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    if (err.status === 401) redirect('/login');
    return <NotAuthorized message={err.message} />;
  }

  // The salesperson is whoever is signed in, not whatever gets typed. The
  // server enforces this too (app/api/proposals/route.ts) — passing it here
  // only lets the form show the value it will actually use.
  return <IntakeForm salespersonName={user.full_name} />;
}
