-- Numara — initial schema: households and users.
-- Implements PRD §8 (the two entities needed for step 1 of §13).
-- Every user-owned table is household-scoped; v1 UI is single-user but the model is household-ready.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger helper (used by every mutable table going forward)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- households
-- ─────────────────────────────────────────────────────────────────────────────
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_currency text not null default 'GBP'
    check (default_currency in ('GBP','USD','CAD')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- users — application profile, 1:1 with auth.users via shared id.
-- household_id is the scoping key for every other user-owned table.
-- is_system_admin gates /admin (PRD §14.1); separate from household role.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete restrict,
  email text not null unique,
  role text not null default 'owner'
    check (role in ('owner','member','viewer')),
  is_system_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_household_id_idx on public.users (household_id);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.households enable row level security;
alter table public.users enable row level security;

-- A user can read/update their own profile row.
create policy users_self_select on public.users
  for select to authenticated
  using (id = auth.uid());

create policy users_self_update on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and household_id = (select u.household_id from public.users u where u.id = auth.uid()));

-- A user can read the households they belong to.
create policy households_member_select on public.households
  for select to authenticated
  using (id in (select u.household_id from public.users u where u.id = auth.uid()));

-- A user can update households they belong to (v1: single owner per household).
create policy households_member_update on public.households
  for update to authenticated
  using (id in (select u.household_id from public.users u where u.id = auth.uid()))
  with check (id in (select u.household_id from public.users u where u.id = auth.uid()));

-- No insert/delete policies on either table for clients — provisioning is
-- handled server-side by the on-signup trigger below (SECURITY DEFINER).

-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-provision: on auth.users signup, create a household + matching users row.
-- v1 UI is single-user, so every signup gets its own household.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household_id uuid;
  household_name text;
begin
  household_name := coalesce(
    nullif(split_part(new.email, '@', 1), ''),
    'Household'
  );

  insert into public.households (name)
  values (household_name)
  returning id into new_household_id;

  insert into public.users (id, household_id, email)
  values (new.id, new_household_id, new.email);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
