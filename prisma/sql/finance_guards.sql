-- =============================================================================
-- finance_guards.sql
--
-- Database-level guarantees for the money tables. Application code can have
-- bugs; these constraints mean a bug cannot silently create or destroy money.
--
-- HOW TO APPLY
--   This file is embedded verbatim at the bottom of
--   prisma/migrations/<timestamp>_finance_core/migration.sql, so a plain
--   `prisma migrate deploy` installs the schema AND these guards together.
--
--   When changing anything here, apply the same change to that migration (or
--   add a new migration containing only the delta). Keep the two in sync; the
--   integration test suite runs `prisma migrate deploy` against an empty
--   database on every run, so a broken migration fails the tests.
--
--   The statements are written to apply to both Supabase and a bare Postgres:
--   the `anon` / `authenticated` roles are created when missing, and the
--   auth.users trigger is attempted only when the `auth` schema exists. If
--   `prisma migrate` still lacks privileges on auth.users, run section 7 by
--   hand in the Supabase SQL editor.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. DIAGNOSTIC - run these two queries FIRST, before anything else.
--
-- Prisma creates tables with plain DDL, which does NOT enable row level
-- security. Supabase, meanwhile, ships default privileges that grant table
-- access to the `anon` and `authenticated` roles, and PostgREST exposes the
-- `public` schema over HTTPS. The anon key is public by design - it ships in
-- your frontend bundle. So a Prisma-created `Wallet` table in `public` may be
-- readable, and possibly writable, by anyone on the internet.
--
-- Verify on YOUR project rather than trusting this comment:
--
--   select relname, relrowsecurity as rls_enabled
--     from pg_class
--    where relnamespace = 'public'::regnamespace and relkind = 'r'
--    order by relname;
--
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee in ('anon', 'authenticated')
--    order by table_name, grantee;
--
-- If `rls_enabled` is false for Wallet/LedgerEntry, or anon shows up with
-- INSERT/UPDATE/DELETE, treat it as a live incident and run section 1 now.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 1. Default-deny the finance tables
-- -----------------------------------------------------------------------------

-- Supabase always provisions the `anon` and `authenticated` roles. A bare
-- PostgreSQL (local development, CI) does not, and every REVOKE below would
-- fail with "role does not exist". Create them as locked-down NOLOGIN roles so
-- this file applies unchanged to both.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin noinherit';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin noinherit';
  end if;
end;
$$;
-- Enabling RLS with ZERO policies denies every non-owner role. Prisma connects
-- as the table owner (`postgres`), and an owner bypasses RLS, so the NestJS
-- service keeps working untouched.
--
-- Deliberately NOT using `force row level security`: that would apply RLS to
-- the owner too and lock Prisma out of its own tables.
alter table public."Wallet"            enable row level security;
alter table public."LedgerTransfer"    enable row level security;
alter table public."LedgerEntry"       enable row level security;
alter table public."Order"             enable row level security;
alter table public."PayoutMethod"      enable row level security;
alter table public."WithdrawalRequest" enable row level security;
alter table public."IdempotencyRecord" enable row level security;
alter table public."AuditLog"          enable row level security;
alter table public."UserProfile"       enable row level security;

-- Belt and braces: remove the grants as well, so even a future permissive
-- policy added by mistake cannot open these up.
revoke all on table
  public."Wallet",
  public."LedgerTransfer",
  public."LedgerEntry",
  public."Order",
  public."PayoutMethod",
  public."WithdrawalRequest",
  public."IdempotencyRecord",
  public."AuditLog",
  public."UserProfile"
from anon, authenticated;

-- Supabase's default privileges re-grant access to EVERY new table, so the next
-- `prisma migrate` would reopen the hole. Flip the default to deny once:
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- From here on, exposing a table to the frontend is an explicit, reviewable act:
--   grant select on public."Product" to anon, authenticated;
--   alter table public."Product" enable row level security;
--   create policy product_public_read on public."Product" for select using (true);


-- -----------------------------------------------------------------------------
-- 2. Invariants that must hold regardless of application code
-- -----------------------------------------------------------------------------

-- A user can never go overdrawn. GATEWAY_CLEARING and WITHDRAWAL_CLEARING are
-- exempt on purpose: they are expected to run negative, because their balance
-- represents money that came in from, or is on its way out to, the outside
-- world. ESCROW is NOT exempt - see the constraint right below.
alter table public."Wallet"
  add constraint wallet_user_balance_non_negative
  check (kind <> 'USER'::"WalletKind" or balance >= 0);

-- Escrow may only hold money that was actually paid in, so it must never go
-- negative. A negative escrow balance would mean someone was credited money
-- that never arrived - worth failing the transaction over.
alter table public."Wallet"
  add constraint wallet_escrow_non_negative
  check (code is distinct from 'ESCROW' or balance >= 0);

-- A user wallet must have an owner; a system wallet must have a code.
alter table public."Wallet"
  add constraint wallet_owner_or_code
  check (
    (kind = 'USER'::"WalletKind" and "ownerId" is not null and code is null)
    or
    (kind <> 'USER'::"WalletKind" and "ownerId" is null and code is not null)
  );

-- A zero-amount leg is always a bug; it means an amount failed to compute.
alter table public."LedgerEntry"
  add constraint ledger_entry_amount_not_zero
  check (amount <> 0);

-- VND has no sub-unit. Rejecting fractional đồng at the database boundary stops
-- rounding bugs from accumulating half-đồng dust across millions of rows.
alter table public."LedgerEntry"
  add constraint ledger_entry_whole_dong
  check (amount = round(amount));

alter table public."Order"
  add constraint order_amounts_sane
  check (
    "grossAmount" >= 0
    and "commissionAmount" >= 0
    and "commissionAmount" <= "grossAmount"
    and "grossAmount" = round("grossAmount")
    and "commissionAmount" = round("commissionAmount")
  );

alter table public."WithdrawalRequest"
  add constraint withdrawal_amount_positive
  check (amount > 0 and amount = round(amount));


-- -----------------------------------------------------------------------------
-- 3. The ledger is append-only
-- -----------------------------------------------------------------------------

create or replace function public.reject_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'ledger rows are immutable: % on %.% is not allowed. Post a reversing transfer instead.',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists ledger_entry_immutable on public."LedgerEntry";
create trigger ledger_entry_immutable
  before update or delete on public."LedgerEntry"
  for each row execute function public.reject_ledger_mutation();

-- LedgerTransfer rows may only ever change `status` (POSTED -> REVERSED).
create or replace function public.restrict_transfer_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'LedgerTransfer rows cannot be deleted'
      using errcode = 'restrict_violation';
  end if;

  if row(new.id, new.kind, new."idempotencyKey", new."orderId", new."createdAt")
     is distinct from
     row(old.id, old.kind, old."idempotencyKey", old."orderId", old."createdAt")
  then
    raise exception 'only LedgerTransfer.status may be updated'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists ledger_transfer_restricted on public."LedgerTransfer";
create trigger ledger_transfer_restricted
  before update or delete on public."LedgerTransfer"
  for each row execute function public.restrict_transfer_update();


-- -----------------------------------------------------------------------------
-- 4. Money is conserved: every transfer must sum to zero
--
-- This is the single most valuable guard in the file. It is a CONSTRAINT
-- trigger deferred to COMMIT, so the service can insert legs one at a time and
-- the check runs once at the end. A transfer that debits a buyer 100,000 and
-- credits a seller only 95,000 - with the 5,000 commission forgotten - cannot
-- be committed at all.
-- -----------------------------------------------------------------------------

create or replace function public.assert_transfer_balanced()
returns trigger
language plpgsql
as $$
declare
  leg_total numeric(18,2);
  leg_count integer;
begin
  select coalesce(sum(amount), 0), count(*)
    into leg_total, leg_count
    from public."LedgerEntry"
   where "transferId" = new."transferId";

  if leg_count < 2 then
    raise exception 'transfer % has only % leg(s); a transfer needs at least 2',
      new."transferId", leg_count
      using errcode = 'check_violation';
  end if;

  if leg_total <> 0 then
    raise exception 'transfer % is unbalanced: sum(amount) = %',
      new."transferId", leg_total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

drop trigger if exists ledger_entry_balanced on public."LedgerEntry";
create constraint trigger ledger_entry_balanced
  after insert on public."LedgerEntry"
  deferrable initially deferred
  for each row execute function public.assert_transfer_balanced();


-- -----------------------------------------------------------------------------
-- 5. Reconciliation
--
-- Wallet.balance is a cache. This view recomputes it from the ledger so drift
-- is visible. Wire it to a scheduled job that alerts on any non-zero drift, and
-- assert `select count(*) from "WalletReconciliation" where drift <> 0` is 0 in
-- your integration tests.
-- -----------------------------------------------------------------------------

create or replace view public."WalletReconciliation" as
select
  w.id                                   as wallet_id,
  w.kind,
  w.code,
  w."ownerId"                            as owner_id,
  w.balance                              as cached_balance,
  coalesce(sum(e.amount), 0)             as ledger_balance,
  w.balance - coalesce(sum(e.amount), 0) as drift
from public."Wallet" w
left join public."LedgerEntry" e on e."walletId" = w.id
group by w.id, w.kind, w.code, w."ownerId", w.balance;

revoke all on public."WalletReconciliation" from anon, authenticated;

-- Global invariant: across the whole system every leg nets to zero.
-- `select * from "LedgerIntegrity"` must always return total_drift = 0.
create or replace view public."LedgerIntegrity" as
select
  coalesce(sum(amount), 0) as total_drift,
  count(*)                 as entry_count
from public."LedgerEntry";

revoke all on public."LedgerIntegrity" from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 6. Seed the system wallets
-- -----------------------------------------------------------------------------

insert into public."Wallet" (id, kind, code, "ownerId", currency, balance, version, "createdAt", "updatedAt")
values
  (gen_random_uuid(), 'ESCROW',              'ESCROW',              null, 'VND', 0, 0, now(), now()),
  (gen_random_uuid(), 'PLATFORM_REVENUE',    'PLATFORM_REVENUE',    null, 'VND', 0, 0, now(), now()),
  (gen_random_uuid(), 'GATEWAY_CLEARING',    'GATEWAY_CLEARING',    null, 'VND', 0, 0, now(), now()),
  (gen_random_uuid(), 'WITHDRAWAL_CLEARING', 'WITHDRAWAL_CLEARING', null, 'VND', 0, 0, now(), now())
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- 7. Keep UserProfile and the user wallet in sync with Supabase Auth
--
-- Without this, a wallet gets lazily created on first use and a race between
-- two concurrent requests can produce a duplicate (the unique index catches it,
-- but the request fails). Provisioning at signup removes the whole class of
-- problem. Run this block in the Supabase SQL editor if `prisma migrate` lacks
-- privileges on the `auth` schema.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public."UserProfile" (id, email, phone, "createdAt", "updatedAt")
  values (new.id, new.email, new.phone, now(), now())
  on conflict (id) do nothing;

  insert into public."Wallet" (id, kind, "ownerId", currency, balance, version, "createdAt", "updatedAt")
  values (gen_random_uuid(), 'USER', new.id, 'VND', 0, 0, now(), now())
  on conflict ("ownerId", currency) do nothing;

  return new;
end;
$$;

-- The `auth` schema exists on Supabase but not on a bare PostgreSQL. On
-- Supabase the trigger is installed when the migration role is allowed to;
-- when it is not, this block raises a notice instead of failing the whole
-- migration, and the statements can be run by hand in the Supabase SQL editor
-- (see the header of this file).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    begin
      execute 'drop trigger if exists on_auth_user_created on auth.users';
      execute 'create trigger on_auth_user_created after insert on auth.users '
              'for each row execute function public.handle_new_auth_user()';
    exception
      when insufficient_privilege or undefined_table then
        raise notice
          'finance_guards: could not create auth.users trigger (%). Run section 7 by hand in the Supabase SQL editor.',
          sqlerrm;
    end;
  else
    raise notice
      'finance_guards: no auth schema found. After Supabase Auth is provisioned, run section 7 by hand in the Supabase SQL editor.';
  end if;
end;
$$;
