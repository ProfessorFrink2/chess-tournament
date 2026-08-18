alter table public.seasons add column if not exists is_hidden boolean not null default true;
alter table public.tournaments add column if not exists is_hidden boolean not null default true;
