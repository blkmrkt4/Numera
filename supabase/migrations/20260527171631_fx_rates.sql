-- Numara — FX rates.
-- PRD §8 FxRate entity, §5.4 currency rules.
-- FX is global data, not household-scoped. All authenticated users can read.
-- Writes are server-side only via the service role.

set search_path = public;

create table public.fx_rates (
  date date not null,
  base_currency text not null
    check (base_currency in ('GBP','USD','CAD')),
  target_currency text not null
    check (target_currency in ('GBP','USD','CAD')),
  rate numeric(20, 10) not null check (rate > 0),
  fetched_at timestamptz not null default now(),
  primary key (date, base_currency, target_currency),
  check (base_currency <> target_currency)
);

-- Lookups by most-recent rate for a (base, target) pair.
create index fx_rates_pair_date_idx
  on public.fx_rates (base_currency, target_currency, date desc);

alter table public.fx_rates enable row level security;

-- Read-only for all signed-in users. No client write policy — the
-- background refresh uses the service role which bypasses RLS.
create policy fx_rates_read on public.fx_rates
  for select to authenticated using (true);
