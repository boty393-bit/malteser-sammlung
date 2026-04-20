-- =========================================
-- MALTESER SAMMLUNG - Supabase Setup SQL
-- Fuer neue Installationen und bestehende Projekte.
-- Dieses SQL einmal komplett im Supabase SQL Editor ausfuehren.
-- =========================================

create extension if not exists pgcrypto;

-- =========================================
-- BASIS-TABELLEN
-- =========================================

create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,
  created_at  timestamptz default now(),
  created_by  text
);

create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references events(id) on delete cascade,
  name        text not null,
  area_paths  jsonb,
  created_at  timestamptz default now()
);

create table if not exists promoters (
  id               uuid primary key default gen_random_uuid(),
  badge_code       text not null unique,
  first_name       text not null,
  last_name        text not null,
  contact_value    text not null,
  contact_type     text not null default 'email',
  password_hash    text,
  role             text not null default 'promoter',
  manager_user_id  uuid references promoters(id) on delete set null,
  team_id          uuid references teams(id) on delete set null,
  is_active        boolean not null default true,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  constraint promoters_badge_code_format check (badge_code ~ '^[0-9]{4}$'),
  constraint promoters_contact_type_check check (contact_type in ('email', 'phone')),
  constraint promoters_role_check check (role in ('admin', 'tc', 'promoter'))
);

create index if not exists promoters_role_idx on promoters(role);
create index if not exists promoters_manager_idx on promoters(manager_user_id);
create index if not exists promoters_team_idx on promoters(team_id);

create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references events(id) on delete cascade,
  user_uid    text not null,
  name        text not null,
  role        text default 'member',
  team_id     uuid references teams(id) on delete set null,
  joined_at   timestamptz default now(),
  unique(event_id, user_uid)
);

create table if not exists locations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references events(id) on delete cascade,
  user_uid    text not null,
  lat         float8 not null,
  lng         float8 not null,
  name        text,
  role        text default 'member',
  team_id     uuid,
  is_paused   boolean default false,
  updated_at  timestamptz default now(),
  unique(event_id, user_uid)
);

create table if not exists visited (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid references events(id) on delete cascade,
  lat             float8 not null,
  lng             float8 not null,
  street          text,
  number          text,
  team_id         uuid,
  marked_by       text,
  marked_by_name  text,
  created_at      timestamptz default now()
);

-- =========================================
-- RLS
-- =========================================

alter table events enable row level security;
alter table teams enable row level security;
alter table promoters enable row level security;
alter table participants enable row level security;
alter table locations enable row level security;
alter table visited enable row level security;

drop policy if exists events_open on events;
create policy events_open on events for all using (true) with check (true);

drop policy if exists teams_open on teams;
create policy teams_open on teams for all using (true) with check (true);

drop policy if exists promoters_open on promoters;
create policy promoters_open on promoters for all using (true) with check (true);

drop policy if exists participants_open on participants;
create policy participants_open on participants for all using (true) with check (true);

drop policy if exists locations_open on locations;
create policy locations_open on locations for all using (true) with check (true);

drop policy if exists visited_open on visited;
create policy visited_open on visited for all using (true) with check (true);

-- =========================================
-- REALTIME
-- =========================================

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'events'
  ) then
    alter publication supabase_realtime add table events;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'teams'
  ) then
    alter publication supabase_realtime add table teams;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'promoters'
  ) then
    alter publication supabase_realtime add table promoters;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'participants'
  ) then
    alter publication supabase_realtime add table participants;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'locations'
  ) then
    alter publication supabase_realtime add table locations;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'visited'
  ) then
    alter publication supabase_realtime add table visited;
  end if;
end
$$;

-- =========================================
-- HINWEIS
-- =========================================
-- Der erste Nutzer, der ueber die App einen Anmeldecode anfordert,
-- wird automatisch als Admin angelegt. Danach kann der Admin Teams
-- erstellen, Nutzer Teams zuweisen und TCs ernennen.
