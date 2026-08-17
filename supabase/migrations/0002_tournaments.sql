-- 0002_tournaments.sql
-- Adds final-tournament (playoff) support and makes the existing tables able to
-- hold historic data that predates the app.
--
-- Safe to run against a database created from the original schema.sql.
-- Every statement is guarded so a re-run is a no-op.

-- ---------------------------------------------------------------------------
-- 1. Close existing drift
-- ---------------------------------------------------------------------------

-- seasons.is_finished is referenced by lib/database.types.ts and app/admin/page.tsx
-- but was never in schema.sql.
alter table public.seasons
  add column if not exists is_finished boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Loosen seasons so historic league phases (which have no real dates) fit
-- ---------------------------------------------------------------------------

alter table public.seasons alter column start_date drop not null;
alter table public.seasons add column if not exists number integer;
alter table public.seasons add column if not exists is_historic boolean not null default false;

-- Numbered seasons must be unique, but live/unnumbered seasons may coexist.
create unique index if not exists seasons_number_key
  on public.seasons (number) where number is not null;

-- ---------------------------------------------------------------------------
-- 3. Loosen players so people without accounts can be recorded
-- ---------------------------------------------------------------------------

-- Historic players (Alicia, Taras, ...) have no auth.users row. Without this
-- they cannot be inserted at all.
alter table public.players alter column user_id drop not null;

-- Several historic players are known only by first name.
alter table public.players alter column chess_com_username drop not null;

alter table public.players
  add column if not exists is_historic boolean not null default false;

-- Inline `unique` created these constraints; replace with partial unique
-- indexes so that many rows may share NULL without colliding.
alter table public.players drop constraint if exists players_user_id_key;
alter table public.players drop constraint if exists players_chess_com_username_key;

create unique index if not exists players_user_id_key
  on public.players (user_id) where user_id is not null;
create unique index if not exists players_chess_com_username_key
  on public.players (lower(chess_com_username)) where chess_com_username is not null;

-- ---------------------------------------------------------------------------
-- 4. Widen divisions from A/B to A/B/C/D (tournament 4 had four divisions)
-- ---------------------------------------------------------------------------

alter table public.players drop constraint if exists players_bracket_check;
alter table public.players add constraint players_bracket_check
  check (bracket in ('A', 'B', 'C', 'D'));

alter table public.matches drop constraint if exists matches_bracket_check;
alter table public.matches add constraint matches_bracket_check
  check (bracket in ('A', 'B', 'C', 'D'));

-- ---------------------------------------------------------------------------
-- 5. New enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type tournament_format as enum
    ('single_elim', 'double_elim', 'round_robin', 'random_wheel', 'mixed');
exception when duplicate_object then null; end $$;

-- Which side of the draw a match sits on. 'championship' covers the ordinary
-- single-elimination case; the others exist because tournament 10 had a
-- consolation bracket and tournament 12's B division was double elimination.
do $$ begin
  create type bracket_kind as enum
    ('championship', 'consolation', 'winners', 'losers');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 6. season_standings
-- ---------------------------------------------------------------------------
-- Historic league data survives only in aggregate -- there is no per-week match
-- data to reconstruct, so computeStandings() in components/BracketTable.tsx
-- cannot produce it. Store the final table directly.

-- `division` is free text, NOT constrained to A-D. The real data needs it:
-- tournament 3's group stage used city names (Saskatoon / Fredericton /
-- Kamloops), tournament 10 split its A division into "A (Alicia)" and
-- "A (Bogdan)", and tournament 12 used "B (X)" and "B (Z)".
create table if not exists public.season_standings (
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

create index if not exists season_standings_season_idx
  on public.season_standings (season_id, division, rank);

-- ---------------------------------------------------------------------------
-- 7. tournaments
-- ---------------------------------------------------------------------------

create table if not exists public.tournaments (
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
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists tournaments_season_idx on public.tournaments (season_id);

-- ---------------------------------------------------------------------------
-- 8. tournament_divisions
-- ---------------------------------------------------------------------------
-- One row per division of a tournament. Note bracket_kind is deliberately NOT
-- here: a single division can have several brackets (championship +
-- consolation, or winners + losers), so it lives on the match instead.

create table if not exists public.tournament_divisions (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id) on delete cascade not null,
  division text not null check (length(division) between 1 and 40),
  format tournament_format not null,
  created_at timestamptz not null default now(),
  unique (tournament_id, division)
);

-- ---------------------------------------------------------------------------
-- 9. tournament_entrants
-- ---------------------------------------------------------------------------
-- Carries the whole record for the random-wheel tournaments (9/11/13/15),
-- which have entrants and placements but no match data at all.

create table if not exists public.tournament_entrants (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id) on delete cascade not null,
  -- NULL for tournaments that were not split into divisions.
  division text check (length(division) between 1 and 40),
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
create unique index if not exists tournament_entrants_unique
  on public.tournament_entrants (tournament_id, coalesce(division, '-'), player_id);

create index if not exists tournament_entrants_player_idx
  on public.tournament_entrants (player_id);

-- ---------------------------------------------------------------------------
-- 10. tournament_matches
-- ---------------------------------------------------------------------------
-- Deliberately separate from public.matches. A league match is a single game
-- with a fixed white/black colour and a match_result enum. A playoff match is a
-- race to N games between two seeds, with no fixed colour -- the bracket PDFs
-- record it as e.g. "3 - 2".

create table if not exists public.tournament_matches (
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
create unique index if not exists tournament_matches_position_unique
  on public.tournament_matches
     (tournament_id, coalesce(division, '-'), bracket_kind, round, slot);

create index if not exists tournament_matches_tournament_idx
  on public.tournament_matches (tournament_id, division, bracket_kind, round, slot);

-- ---------------------------------------------------------------------------
-- 11. Row level security -- mirrors the existing pattern in schema.sql:
--     public read, admin write.
-- ---------------------------------------------------------------------------

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
    execute format('drop policy if exists "Anyone can read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Anyone can read %1$s" on public.%1$I for select using (true)', t);

    execute format('drop policy if exists "Admins can manage %1$s" on public.%1$I', t);
    execute format(
      'create policy "Admins can manage %1$s" on public.%1$I for all using ('
      '  exists (select 1 from public.profiles where id = auth.uid() and role = ''admin'')'
      ')', t);
  end loop;
end $$;
