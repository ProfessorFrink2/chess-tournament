-- Stores the chess.com PGN and derived stats for a league or tournament game.
-- Scoped to games tied to a recorded match/tournament_match -- not a player's
-- whole chess.com history -- since that's what the stats page needs.
create table public.games (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.matches(id) on delete cascade,
  tournament_match_id uuid references public.tournament_matches(id) on delete cascade,
  white_player_id uuid references public.players(id) not null,
  black_player_id uuid references public.players(id) not null,
  chess_com_url text not null unique,
  pgn text not null,
  result match_result not null,
  time_control text,
  rules text,
  time_class text,
  ply_count integer not null,
  end_time timestamptz not null,
  -- Shape produced by lib/pgn.ts's parseGameStats() -- see that file for the
  -- authoritative structure. Stored once at import time so the stats page
  -- never has to re-parse a PGN.
  stats jsonb not null,
  created_at timestamptz not null default now(),
  constraint games_one_parent check (
    (match_id is not null and tournament_match_id is null) or
    (match_id is null and tournament_match_id is not null)
  )
);
create index games_match_idx on public.games (match_id);
create index games_tournament_match_idx on public.games (tournament_match_id);
create index games_white_idx on public.games (white_player_id);
create index games_black_idx on public.games (black_player_id);

alter table public.games enable row level security;
create policy "Anyone can read games" on public.games
  for select using (true);
create policy "Service role can manage games" on public.games
  for all using (true);
