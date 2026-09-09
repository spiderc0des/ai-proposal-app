import { redirect } from 'next/navigation';
import { requireUser, AuthError } from '@/lib/auth';
import IntakeForm from './IntakeForm';
import NotAuthorized from '../NotAuthorized';

export default async function NewProposalPage() {
  try {
    await requireUser('sales');
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    if (err.status === 401) redirect('/login');
    return <NotAuthorized message={err.message} />;
  }

  return <IntakeForm />;
}
