'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowserClient } from '@/lib/supabase-browser';

/** Set by app/auth/confirm when an invitation link cannot be used. */
const LINK_ERRORS: Record<string, string> = {
  link_expired:
    'That invitation link has expired or has already been used. Ask the admin who invited you to send a new one — or, if you have accepted before, just sign in below.',
  invalid_link: 'That link is incomplete. Try copying the whole link from the email.',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');

  // Read in an effect rather than with useSearchParams(), which in Next 15
  // would require wrapping this page in a Suspense boundary to build.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (code && LINK_ERRORS[code]) setLinkError(LINK_ERRORS[code]);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError('');
    const supabase = supabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setStatus('error');
      setError(error.message);
      return;
    }
    setStatus('sent');
  }

  return (
    <div className="max-w-sm mx-auto mt-12 sm:mt-20">
      <div className="flex justify-center mb-6">
        <span
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-white text-lg font-bold shadow-[var(--shadow-md)]"
          style={{ background: 'var(--accent)' }}
        >
          K
        </span>
      </div>
      <h1 className="text-xl font-semibold mb-2 text-center">Sign in</h1>
      <p className="text-sm text-[var(--ink-soft)] mb-6 text-center text-balance">
        We&apos;ll email you a link — no password needed. Being able to sign in only
        means you exist as a user; whether you can do anything here also depends on
        being on the team&apos;s allowlist.
      </p>

      {linkError && status !== 'sent' && (
        <div className="panel panel-warning mb-4 text-sm">{linkError}</div>
      )}

      {status === 'sent' ? (
        <div className="panel panel-success">
          Check <span className="font-medium">{email}</span> for a sign-in link.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="label">Email</span>
            <input
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
          </label>
          <button type="submit" disabled={status === 'sending'} className="btn btn-primary w-full">
            {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
          </button>
          {status === 'error' && <p className="text-sm text-[var(--red)]">{error}</p>}
        </form>
      )}
    </div>
  );
}
