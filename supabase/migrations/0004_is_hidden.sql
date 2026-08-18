alter table public.seasons add column if not exists is_hidden boolean not null default false;
alter table public.tournaments add column if not exists is_hidden boolean not null default false;
