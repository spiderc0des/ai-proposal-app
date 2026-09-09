'use client';
import { useState } from 'react';
import { supabaseBrowserClient } from '@/lib/supabase-browser';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

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
