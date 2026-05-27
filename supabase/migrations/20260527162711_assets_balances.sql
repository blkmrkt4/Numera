-- Numara — assets, balances, and institutions.
-- Implements PRD §8 entities: Institution, Asset, BalanceEntry.
-- Step 2 of §13: manual asset and balance entry, totals work without FX.
-- Real estate is treated as a plain Asset here; Property/PropertyValuation
-- tables and sale scenario are deferred to step 9 per the build sequence.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: current user's household_id. Used by RLS policies and as the
-- default for household_id columns on insert (the server action never has
-- to compute it client-side, which keeps cross-household writes impossible
-- to fabricate from the wire).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.users where id = auth.uid();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- institutions — per-household, free-text now. Normalisation prompt arrives
-- in step 7 (PRD §14.7 normalise_institution_name).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  type text check (type is null or type in ('bank','brokerage','mortgage_lender','utility','other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- De-dupe institutions per household by case-insensitive name.
create unique index institutions_household_name_uniq
  on public.institutions (household_id, lower(name));

create trigger institutions_set_updated_at
  before update on public.institutions
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- assets — every user-owned thing of value (or owed).
-- account_last4: never the full account number, per PRD §6.1.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text not null
    check (category in ('real_estate','investment','cash','liability')),
  institution_id uuid references public.institutions(id) on delete set null,
  account_last4 text check (account_last4 is null or account_last4 ~ '^\d{4}$'),
  native_currency text not null
    check (native_currency in ('GBP','USD','CAD')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assets_household_active_idx
  on public.assets (household_id, category)
  where archived = false;

create index assets_institution_idx on public.assets (institution_id)
  where institution_id is not null;

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- balance_entries — one row per captured balance for an asset.
-- amount is in the asset's native currency (CLAUDE.md: numeric(20,4), never float).
-- source_document_id is reserved for step 4 when the documents table arrives;
-- column exists but no FK constraint yet (FK is added with the documents migration).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.balance_entries (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  amount numeric(20, 4) not null,
  as_of_date date not null check (as_of_date <= current_date),
  source text not null default 'manual'
    check (source in ('document','manual')),
  source_document_id uuid,
  confidence numeric(3, 2)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  manually_edited boolean not null default false,
  created_at timestamptz not null default now()
);

create index balance_entries_asset_recent_idx
  on public.balance_entries (asset_id, as_of_date desc, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.institutions enable row level security;
alter table public.assets enable row level security;
alter table public.balance_entries enable row level security;

-- institutions: scope by household_id.
create policy institutions_member_all on public.institutions
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

-- assets: scope by household_id.
create policy assets_member_all on public.assets
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

-- balance_entries: scope via the parent asset's household_id.
create or replace function public.is_my_asset(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and a.household_id = (
        select household_id from public.users where id = auth.uid()
      )
  );
$$;

create policy balance_entries_my_asset on public.balance_entries
  for all to authenticated
  using (public.is_my_asset(asset_id))
  with check (public.is_my_asset(asset_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- View: latest balance per asset.
-- The dashboard reads this to compute totals. security_invoker = true makes
-- the view run with the caller's permissions so RLS on the underlying tables
-- applies (PG 15+).
-- ─────────────────────────────────────────────────────────────────────────────
create view public.asset_latest_balances
with (security_invoker = true) as
select distinct on (be.asset_id)
  be.asset_id,
  be.amount,
  be.as_of_date,
  be.source,
  be.id as balance_entry_id
from public.balance_entries be
order by be.asset_id, be.as_of_date desc, be.created_at desc;
