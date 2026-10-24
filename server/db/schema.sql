-- WattWay · Team Kothimbir 🌿
-- schema.sql — the Postgres schema (Supabase). Applied to production as the
-- `wattway_core_schema` migration and loaded into PGlite by the integration
-- tests, so both run the same DDL.

create extension if not exists citext;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  email citext not null unique,
  password_hash text not null,
  role text not null default 'driver' check (role in ('driver','operator','admin')),
  vehicle jsonb,
  token_version integer not null default 0,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists users_role_idx on users (role);

create table if not exists stations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  operator text not null,
  address jsonb not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  price_per_kwh numeric(8,2) not null check (price_per_kwh between 0 and 500),
  rating_average numeric(3,2) not null default 0 check (rating_average between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  ports jsonb not null default '[]'::jsonb,
  amenities text[] not null default '{}',
  is_active boolean not null default true,
  queue_length integer not null default 0 check (queue_length >= 0),
  graph_node_id text,
  managed_by uuid references users(id) on delete set null,
  -- Where the row came from: an operator's API call, the curated seed, or OpenStreetMap.
  source text not null default 'manual' check (source in ('manual','seed','osm')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists stations_external_id_key on stations (source, external_id) where external_id is not null;
create unique index if not exists stations_name_city_key on stations (name, (address->>'city'));
create index if not exists stations_active_price_idx on stations (is_active, price_per_kwh);
create index if not exists stations_active_rating_idx on stations (is_active, rating_average desc);
create index if not exists stations_operator_idx on stations (operator);
create index if not exists stations_managed_by_idx on stations (managed_by);
create index if not exists stations_lat_lng_idx on stations (lat, lng);

-- Which stations an operator account manages (a convenience mirror of stations.managed_by).
create table if not exists station_operators (
  user_id uuid not null references users(id) on delete cascade,
  station_id uuid not null references stations(id) on delete cascade,
  primary key (user_id, station_id)
);
create index if not exists station_operators_station_idx on station_operators (station_id);

create table if not exists station_ratings (
  station_id uuid not null references stations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (station_id, user_id)
);
create index if not exists station_ratings_user_idx on station_ratings (user_id);

create table if not exists queue_entries (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','charging','completed','cancelled','expired')),
  position integer not null default 0 check (position >= 0),
  port_index integer check (port_index >= 0),
  joined_at timestamptz not null default now(),
  started_charging_at timestamptz,
  finished_at timestamptz,
  estimated_wait_minutes_at_join numeric,
  -- Urgency details, so the line keeps its priorities across serverless instances.
  battery_pct numeric check (battery_pct between 0 and 100),
  emergency boolean not null default false,
  expected_charge_minutes numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists queue_entries_station_status_joined_idx on queue_entries (station_id, status, joined_at);
create index if not exists queue_entries_user_idx on queue_entries (user_id);
create unique index if not exists queue_entries_one_active_per_user on queue_entries (station_id, user_id)
  where status in ('waiting','charging');

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  origin_lat double precision not null,
  origin_lng double precision not null,
  origin_label text,
  destination_lat double precision not null,
  destination_lng double precision not null,
  destination_label text,
  battery_start_pct numeric not null check (battery_start_pct between 0 and 100),
  stops jsonb not null default '[]'::jsonb,
  route jsonb,
  distance_km numeric,
  estimated_duration_minutes numeric,
  status text not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  previous_trip_id uuid references trips(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trips_user_created_idx on trips (user_id, created_at desc);
create index if not exists trips_previous_idx on trips (previous_trip_id);
