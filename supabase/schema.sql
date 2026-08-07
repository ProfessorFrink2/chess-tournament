-- Run this in Supabase SQL editor after creating your project

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles table (extends auth.users)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  role text not null default 'player' check (role in ('player', 'admin')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users can read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Admins can read all profiles" on public.profiles
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Players table
create table public.players (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null unique,
  chess_com_username text not null unique,
  display_name text not null,
  bracket text check (bracket in ('A', 'B')),
  created_at timestamptz not null default now()
);
alter table public.players enable row level security;
create policy "Anyone can read players" on public.players
  for select using (true);
create policy "Players can update own record" on public.players
  for update using (auth.uid() = user_id);
create policy "Admins can update any player" on public.players
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy "Users can insert own player record" on public.players
  for insert with check (auth.uid() = user_id);

-- Seasons table
create table public.seasons (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  start_date date not null,
  end_date date,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.seasons enable row level security;
create policy "Anyone can read seasons" on public.seasons
  for select using (true);
create policy "Admins can manage seasons" on public.seasons
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Matches table
create type match_result as enum ('white_wins', 'black_wins', 'draw', 'pending');
create table public.matches (
  id uuid primary key default uuid_generate_v4(),
  season_id uuid references public.seasons(id) on delete cascade not null,
  bracket text not null check (bracket in ('A', 'B')),
  week_number integer not null,
  white_player_id uuid references public.players(id) not null,
  black_player_id uuid references public.players(id) not null,
  scheduled_start date not null,
  scheduled_end date not null,
  result match_result not null default 'pending',
  chess_com_game_url text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint different_players check (white_player_id != black_player_id)
);
alter table public.matches enable row level security;
create policy "Anyone can read matches" on public.matches
  for select using (true);
create policy "Admins can manage matches" on public.matches
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy "Service role can update matches" on public.matches
  for update using (true);

-- Index for cron job performance
create index matches_pending_idx on public.matches (result, scheduled_end)
  where result = 'pending';

-- Function to auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
