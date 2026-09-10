-- ════════════════════════════════════════════════════════════════════════════
-- 07 · Fix deliveries.provider. Run once. Safe to re-run.
--
-- WHY: the column was created as `provider text not null default 'resend'`,
-- from before this app switched to Gmail SMTP, and recordDelivery() never
-- wrote it. So every row silently claimed 'resend' while carrying a Gmail
-- Message-ID in provider_id — visibly wrong the moment anyone opened the
-- table, and wrong for as long as nobody did.
--
-- Two changes:
--   1. Backfill the existing rows. Justified by the data, not by assumption:
--      every affected row's provider_id ends in '@gmail.com>', which is a
--      Gmail Message-ID and could not have come from Resend. The WHERE
--      clause below only touches rows that prove it themselves.
--   2. Drop the default. A default on a column no caller writes is not a
--      convenience, it is a silent lie — with none, an insert that forgets
--      the column fails loudly. lib/queries.ts recordDelivery() now passes
--      it, so apply this together with that code, not before it.
--
-- If you are setting this project up FRESH, skip this file — the current
-- 01-schema.sql already declares the column without a default.
-- ════════════════════════════════════════════════════════════════════════════

-- 1 · Backfill only the rows whose own provider_id proves Gmail sent them.
update deliveries
   set provider = 'gmail'
 where provider = 'resend'
   and provider_id like '%@gmail.com>';

-- Anything still on 'resend' has no Gmail Message-ID to vouch for it, so it
-- is left alone rather than guessed at, and reported here instead.
do $$
declare
  unproven int;
begin
  select count(*) into unproven from deliveries where provider = 'resend';
  if unproven > 0 then
    raise notice
      '% delivery row(s) still say resend and have no Gmail Message-ID to prove otherwise — left untouched, check them by hand.',
      unproven;
  end if;
end $$;

-- 2 · No more default.
alter table deliveries alter column provider drop default;

select
  provider,
  count(*) as rows
from deliveries
group by provider
order by provider;
