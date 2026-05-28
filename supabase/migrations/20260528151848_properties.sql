-- Numara — real-estate special path.
-- Per PRD §13 step 9 / §5.5 / §8 (Property, PropertyValuation).
-- Each real-estate Asset gets a 1:1 Property row holding address +
-- purchase metadata, plus a PropertyValuation series (the user-entered
-- market-value history) and an optional FK to the mortgage Asset that
-- backs it.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────
-- properties — 1:1 with assets where category = 'real_estate'.
-- mortgage_asset_id is nullable: not every property has a mortgage,
-- and at asset-creation time the user may not have the mortgage as a
-- separate asset yet.
-- ─────────────────────────────────────────────────────────────────────
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.assets(id) on delete cascade,
  address text not null check (length(trim(address)) > 0),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  purchase_date date,
  purchase_price numeric(20, 4) check (purchase_price is null or purchase_price >= 0),
  purchase_currency text check (purchase_currency is null or purchase_currency in ('GBP','USD','CAD')),
  mortgage_asset_id uuid references public.assets(id) on delete set null,
  sale_cost_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A property can't be its own mortgage.
  check (mortgage_asset_id is null or mortgage_asset_id <> asset_id)
);

create index properties_mortgage_idx on public.properties (mortgage_asset_id)
  where mortgage_asset_id is not null;

create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

alter table public.properties enable row level security;

-- Ownership flows through the 1:1 asset. is_my_asset() already returns
-- true iff the asset belongs to the caller's household, so the policy
-- becomes a one-liner.
create policy properties_member_all on public.properties
  for all to authenticated
  using (public.is_my_asset(asset_id))
  with check (public.is_my_asset(asset_id));

-- ─────────────────────────────────────────────────────────────────────
-- property_valuations — manually-entered market-value history.
-- This is the real-estate equivalent of balance_entries. We also write
-- a balance_entries row for each valuation so the dashboard and the
-- asset_latest_balances view continue to work unchanged for real-estate
-- assets — see lib/properties.ts addValuation().
-- ─────────────────────────────────────────────────────────────────────
create table public.property_valuations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  estimated_value numeric(20, 4) not null check (estimated_value > 0),
  as_of_date date not null check (as_of_date <= current_date),
  note text,
  -- Link to the synthetic balance_entries row so we can delete/edit
  -- both halves together later.
  balance_entry_id uuid references public.balance_entries(id) on delete set null,
  created_at timestamptz not null default now()
);

create index property_valuations_recent_idx
  on public.property_valuations (property_id, as_of_date desc, created_at desc);

alter table public.property_valuations enable row level security;

-- Climb property → asset → household for the policy. The properties.id
-- subquery is bounded (1 row, indexed by PK), so this stays cheap.
create policy property_valuations_member_all on public.property_valuations
  for all to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id and public.is_my_asset(p.asset_id)
    )
  )
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id and public.is_my_asset(p.asset_id)
    )
  );
