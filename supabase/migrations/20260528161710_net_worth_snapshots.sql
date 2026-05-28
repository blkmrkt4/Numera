-- Numara — historical net worth snapshots.
-- Per PRD §13 step 12 / §5.9 / §8 (NetWorthSnapshot).
-- One row per household per snapshot_date. totals_by_currency holds the
-- net worth pre-converted to each display currency using FX rates of
-- that day, so the chart re-renders instantly when the user toggles
-- currency — no recomputation.

set search_path = public;

create table public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households(id) on delete cascade,
  snapshot_date date not null,
  -- {real_estate: {GBP: 123.45, USD: 165.00, CAD: 230.00}, investment: ...}
  totals_by_category jsonb not null,
  -- {GBP: net_worth_in_gbp, USD: net_worth_in_usd, CAD: net_worth_in_cad}
  -- Liabilities already subtracted.
  totals_by_currency jsonb not null,
  -- The FX rate map used at the time of computation.
  fx_rates_used jsonb not null,
  trigger text not null check (trigger in ('auto_monthly','manual')),
  -- When a household has no asset balance on or before the snapshot date,
  -- per PRD §5.9 we carry forward the most recent prior balance. This
  -- flag marks any snapshot where at least one asset's contribution was
  -- carried, so the chart can hint at imputed data.
  any_carried boolean not null default false,
  created_at timestamptz not null default now(),
  unique (household_id, snapshot_date)
);

create index net_worth_snapshots_household_date_idx
  on public.net_worth_snapshots (household_id, snapshot_date desc);

alter table public.net_worth_snapshots enable row level security;

-- Read is fine for household members; writes go through the
-- service-role admin client from a SECURITY DEFINER server action,
-- so no client write policy.
create policy net_worth_snapshots_member_select on public.net_worth_snapshots
  for select to authenticated
  using (household_id = public.current_household_id());
