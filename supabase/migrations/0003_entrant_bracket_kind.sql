-- 0003_entrant_bracket_kind.sql
--
-- Fixes tournament 10, which reported two champions in its A division.
--
-- A division can hold more than one bracket: tournament 10's A division had a
-- championship AND a consolation bracket, each with its own 1st and 2nd place.
-- tournament_entrants scoped final_placement to (tournament, division) only, so
-- the consolation winner and the championship winner both stored placement 1.
--
-- bracket_kind was already on tournament_matches for exactly this reason; the
-- entrant row needs it too, so a placement means "position within this
-- bracket" rather than "position within this division".
--
-- Safe to re-run.

alter table public.tournament_entrants
  add column if not exists bracket_kind bracket_kind not null default 'championship';

-- The uniqueness rule changes with it: a player may appear once per bracket,
-- not once per division.
drop index if exists tournament_entrants_unique;
create unique index if not exists tournament_entrants_unique
  on public.tournament_entrants
     (tournament_id, coalesce(division, '-'), bracket_kind, player_id);
