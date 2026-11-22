-- Money Book database setup (already applied to your project by Claude; kept for reference).
-- Creates two private tables. Row Level Security means each signed-in user
-- can only ever see or change their own rows; signed-out visitors see nothing.

create table if not exists public.entries (
  id         text primary key check (char_length(id) between 1 and 64),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  type       text not null check (type in ('expense','income','transfer','save')),
  amount     numeric(12,2) not null check (amount > 0 and amount < 100000000),
  cat        text check (char_length(cat) <= 40),
  acc        text not null check (char_length(acc) <= 64),
  to_acc     text check (char_length(to_acc) <= 64),
  note       text check (char_length(note) <= 200),
  goal       text check (char_length(goal) <= 64),
  bill       text check (char_length(bill) <= 64),
  period     text check (period ~ '^\d{4}-\d{2}$'),
  plan       text check (char_length(plan) <= 64),
  reimb      text check (char_length(reimb) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists entries_user_date on public.entries (user_id, date);

create table if not exists public.settings (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  config     jsonb not null default '{}'::jsonb check (pg_column_size(config) < 200000),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before update on public.entries
  for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

alter table public.entries  enable row level security;
alter table public.settings enable row level security;

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Signed-out visitors get no access at all.
revoke all on public.entries, public.settings from anon;
grant select, insert, update, delete on public.entries, public.settings to authenticated;
