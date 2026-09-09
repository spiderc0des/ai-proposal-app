import 'server-only';
import postgres from 'postgres';
import { env } from './env';

/**
 * The one Postgres client for the whole app.
 *
 * Always the service role's connection: every query here runs with full
 * access, so every route that calls it MUST check who is asking and what
 * they're allowed to do before it does — authorisation lives in the route
 * handlers, not in Postgres row-level-security policies.
 */
export const sql = postgres(...parseConnectionString(env.DATABASE_URL), {
  // Supabase's pooled connection (port 6543) is a transaction pooler —
  // named prepared statements don't survive across pooled connections.
  prepare: false,
});

/**
 * postgres.js parses `DATABASE_URL` with the browser's URL parser, which
 * calls `decodeURIComponent` on the password. A password copied verbatim
 * from Supabase's connection-string screen is NOT pre-encoded — if it
 * contains `@`, `%`, `#`, `/`, `:`, or `?`, the parse throws a bare
 * "URI malformed" with a stack trace pointing at a dependency, not at the
 * actual problem. This turns that into a message that says what to fix.
 */
function parseConnectionString(url: string): [string] {
  try {
    decodeURIComponent(url);
    return [url];
  } catch {
    throw new Error(
      `DATABASE_URL is not a valid connection string — its password contains a ` +
        `character (one of @ % # / : ?) that needs percent-encoding.\n\n` +
        `Fix: encode just the password portion (between the ':' after your username ` +
        `and the '@' before the host). For example, '%' becomes '%25', '@' becomes ` +
        `'%40', '#' becomes '%23'.`,
    );
  }
}
