-- Replaces the single starred boolean with per-player star votes, so any
-- player (not just the two in the match) can star a game and the UI can
-- show a star count.
alter table public.games drop column starred;

create table public.game_stars (
  id uuid primary key default uuid_generate_v4(),
  game_id uuid references public.games(id) on delete cascade not null,
  player_id uuid references public.players(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (game_id, player_id)
);
create index game_stars_game_idx on public.game_stars (game_id);

alter table public.game_stars enable row level security;
create policy "Anyone can read game stars" on public.game_stars
  for select using (true);
create policy "Service role can manage game stars" on public.game_stars
  for all using (true);
