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
-- user_id and chess_com_username are nullable so historic players -- people who
-- appear in past tournament records but never had an account -- exist as real
-- rows. A later signup claims one via /api/players/claim.
create table public.players (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade,
  chess_com_username text,
  display_name text not null,
  bracket text check (bracket in ('A', 'B', 'C', 'D')),
  is_historic boolean not null default false,
  created_at timestamptz not null default now()
);
-- Partial unique indexes rather than plain UNIQUE: many unclaimed players share
-- a NULL user_id, and first-name-only historic players share a NULL username.
create unique index players_user_id_key
  on public.players (user_id) where user_id is not null;
create unique index players_chess_com_username_key
  on public.players (lower(chess_com_username)) where chess_com_username is not null;
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
-- start_date is nullable because historic league phases were never dated.
create table public.seasons (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  number integer,
  start_date date,
  end_date date,
  is_active boolean not null default false,
  is_finished boolean not null default false,
  is_historic boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index seasons_number_key
  on public.seasons (number) where number is not null;
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
  bracket text not null check (bracket in ('A', 'B', 'C', 'D')),
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

-- ===========================================================================
-- Final tournaments (playoffs)
-- ===========================================================================

create type tournament_format as enum
  ('single_elim', 'double_elim', 'round_robin', 'random_wheel', 'mixed');

-- Which side of the draw a match sits on. 'championship' covers the ordinary
-- single-elimination case; the others exist because tournament 10 had a
-- consolation bracket and tournament 12's B division was double elimination.
create type bracket_kind as enum
  ('championship', 'consolation', 'winners', 'losers');

-- Final league table for a season. Historic league data survives only in
-- aggregate -- there is no per-week match data to reconstruct, so
-- computeStandings() in components/BracketTable.tsx cannot produce it.
-- `division` is free text, NOT constrained to A-D. The real data needs it:
-- tournament 3's group stage used city names (Saskatoon / Fredericton /
-- Kamloops), tournament 10 split its A division into "A (Alicia)" and
-- "A (Bogdan)", and tournament 12 used "B (X)" and "B (Z)".
create table public.season_standings (
  id uuid primary key default uuid_generate_v4(),
  season_id uuid references public.seasons(id) on delete cascade not null,
  division text not null check (length(division) between 1 and 40),
  player_id uuid references public.players(id) on delete cascade not null,
  rank integer not null,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  points integer not null default 0,
  created_at timestamptz not null default now(),
  unique (season_id, division, player_id)
);
create index season_standings_season_idx
  on public.season_standings (season_id, division, rank);

create table public.tournaments (
  id uuid primary key default uuid_generate_v4(),
  -- Nullable: tournaments 7, 9, 11, 13 and 15 had no league phase behind them.
  season_id uuid references public.seasons(id) on delete set null,
  number integer not null unique,
  name text not null,
  format tournament_format not null,
  start_date date,
  end_date date,
  is_active boolean not null default false,
  is_finished boolean not null default false,
  is_hidden boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index tournaments_season_idx on public.tournaments (season_id);

-- One row per division of a tournament. bracket_kind is deliberately NOT here:
-- a single division can have several brackets (championship + consolation, or
-- winners + losers), so it lives on the match instead.
create table public.tournament_divisions (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id) on delete cascade not null,
  division text not null check (length(division) between 1 and 40),
  format tournament_format not null,
  created_at timestamptz not null default now(),
  unique (tournament_id, division)
);

-- Carries the whole record for the random-wheel tournaments (9/11/13/15),
-- which have entrants and placements but no match data at all.
create table public.tournament_entrants (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id) on delete cascade not null,
  division text check (length(division) between 1 and 40),
  -- A division can hold several brackets (tournament 10's A division had a
  -- championship and a consolation), each with its own 1st and 2nd place, so a
  -- placement is scoped to a bracket rather than to the division.
  bracket_kind bracket_kind not null default 'championship',
  player_id uuid references public.players(id) on delete cascade not null,
  seed integer,
  final_placement integer,
  -- Some playoffs had a group phase of their own before the knockout (e.g.
  -- tournament 3's A/B/C playoff divisions were round robins). That record
  -- lives here; it is NULL for a straight knockout entrant.
  wins integer,
  draws integer,
  losses integer,
  points integer,
  created_at timestamptz not null default now()
);
-- Postgres treats NULLs as distinct in a UNIQUE constraint, which would let a
-- division-less tournament hold the same player twice. Coalesce to dodge that.
create unique index tournament_entrants_unique
  on public.tournament_entrants
     (tournament_id, coalesce(division, '-'), bracket_kind, player_id);
create index tournament_entrants_player_idx
  on public.tournament_entrants (player_id);

-- Deliberately separate from public.matches. A league match is a single game
-- with a fixed white/black colour and a match_result enum. A playoff match is a
-- race to N games between two seeds with no fixed colour -- the bracket PDFs
-- record it as e.g. "3 - 2".
create table public.tournament_matches (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id) on delete cascade not null,
  division text check (length(division) between 1 and 40),
  bracket_kind bracket_kind not null default 'championship',
  round integer not null,
  slot integer not null,
  -- Nullable: an unplayed slot, or a bye where only one side is populated.
  player_a_id uuid references public.players(id) on delete set null,
  player_b_id uuid references public.players(id) on delete set null,
  seed_a integer,
  seed_b integer,
  score_a integer,
  score_b integer,
  winner_id uuid references public.players(id) on delete set null,
  is_medal_game boolean not null default false,
  label text,
  next_match_id uuid references public.tournament_matches(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tournament_matches_distinct_players
    check (player_a_id is null or player_b_id is null or player_a_id <> player_b_id),
  constraint tournament_matches_winner_played
    check (winner_id is null or winner_id = player_a_id or winner_id = player_b_id)
);
-- Idempotency key for the history import: re-running must update, not duplicate.
create unique index tournament_matches_position_unique
  on public.tournament_matches
     (tournament_id, coalesce(division, '-'), bracket_kind, round, slot);
create index tournament_matches_tournament_idx
  on public.tournament_matches (tournament_id, division, bracket_kind, round, slot);

-- RLS: public read, admin write -- same pattern as the tables above.
alter table public.season_standings     enable row level security;
alter table public.tournaments          enable row level security;
alter table public.tournament_divisions enable row level security;
alter table public.tournament_entrants  enable row level security;
alter table public.tournament_matches   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'season_standings', 'tournaments', 'tournament_divisions',
    'tournament_entrants', 'tournament_matches'
  ] loop
    execute format(
      'create policy "Anyone can read %1$s" on public.%1$I for select using (true)', t);
    execute format(
      'create policy "Admins can manage %1$s" on public.%1$I for all using ('
      '  exists (select 1 from public.profiles where id = auth.uid() and role = ''admin'')'
      ')', t);
  end loop;
end $$;

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
