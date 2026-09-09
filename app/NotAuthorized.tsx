/**
 * Rendered when someone has a valid Supabase session but AuthError came
 * back 403 — not on the allowlist, or signed in with the wrong role. Never
 * rendered for a 401 (no session at all); that case redirects to /login,
 * where a sign-out link would make no sense.
 */
export default function NotAuthorized({ message }: { message: string }) {
  return (
    <div className="max-w-sm mx-auto mt-16 text-center">
      <div className="flex justify-center mb-4">
        <span
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold"
          style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
        >
          !
        </span>
      </div>
      <h1 className="text-lg font-semibold mb-2">Not authorized</h1>
      <p className="text-sm text-[var(--ink-soft)] mb-6">{message}</p>
      <form action="/auth/signout" method="post">
        <button type="submit" className="btn-link text-sm">
          Sign out and try a different account
        </button>
      </form>
    </div>
  );
}
