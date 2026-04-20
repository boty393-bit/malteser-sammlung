-- =========================================
-- MALTESER SAMMLUNG – Supabase Setup SQL
-- In der Supabase Console ausführen:
-- SQL Editor → New query → einfügen → Run
-- =========================================

-- ── Tabellen erstellen ──────────────────────────────────────

create table if not exists events (
  id          uuid    default gen_random_uuid() primary key,
  name        text    not null,
  code        text    not null unique,
  created_at  timestamptz default now(),
  created_by  text
);

create table if not exists teams (
  id          uuid    default gen_random_uuid() primary key,
  event_id    uuid    references events(id) on delete cascade,
  name        text    not null,
  area_paths  jsonb,
  created_at  timestamptz default now()
);

create table if not exists participants (
  id          uuid    default gen_random_uuid() primary key,
  event_id    uuid    references events(id) on delete cascade,
  user_uid    text    not null,
  name        text    not null,
  role        text    default 'member',
  team_id     uuid    references teams(id) on delete set null,
  joined_at   timestamptz default now(),
  unique(event_id, user_uid)
);

create table if not exists locations (
  id          uuid    default gen_random_uuid() primary key,
  event_id    uuid    references events(id) on delete cascade,
  user_uid    text    not null,
  lat         float8  not null,
  lng         float8  not null,
  name        text,
  role        text    default 'member',
  team_id     uuid,
  is_paused   boolean default false,
  updated_at  timestamptz default now(),
  unique(event_id, user_uid)
);

create table if not exists visited (
  id              uuid    default gen_random_uuid() primary key,
  event_id        uuid    references events(id) on delete cascade,
  lat             float8  not null,
  lng             float8  not null,
  street          text,
  number          text,
  team_id         uuid,
  marked_by       text,
  marked_by_name  text,
  created_at      timestamptz default now()
);

-- ── Row Level Security: offen für alle eingeloggten User ───

alter table events       enable row level security;
alter table teams        enable row level security;
alter table participants enable row level security;
alter table locations    enable row level security;
alter table visited      enable row level security;

create policy "open" on events       for all using (true) with check (true);
create policy "open" on teams        for all using (true) with check (true);
create policy "open" on participants for all using (true) with check (true);
create policy "open" on locations    for all using (true) with check (true);
create policy "open" on visited      for all using (true) with check (true);

-- ── Realtime für alle Tabellen aktivieren ──────────────────

alter publication supabase_realtime add table
  events, teams, participants, locations, visited;

-- ── Fertig! ────────────────────────────────────────────────
-- Die App kann jetzt gestartet werden.
