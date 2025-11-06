-- Supabase schema for FunMeter backend (organizations, groups, users, register faces, attendance, config, billing)

-- Enable extensions (may already be enabled in Supabase)
-- create extension if not exists "uuid-ossp";

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  username text not null,
  api_key text not null,
  is_admin boolean not null default false,
  is_owner boolean not null default false,
  promoted_by text,
  promoted_at timestamptz,
  demoted_by text,
  demoted_at timestamptz,
  api_key_rotated_by text,
  api_key_rotated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  unique (org_id, username)
);

-- People registered (face identities)
create table if not exists persons (
  person_id text primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  label text not null,
  photo_path text,
  created_at timestamptz not null default now()
);

-- Optional: faces catalog mirroring existing register list
create table if not exists register_faces (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  person_id text not null references persons(person_id) on delete cascade,
  label text not null,
  embedding real[],
  photo_path text,
  x int,
  y int,
  width int,
  height int,
  ts text
);

-- Group memberships
create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  person_id text not null references persons(person_id) on delete cascade,
  primary key (group_id, person_id)
);

-- Attendance JSON store (compat layer for legacy code)
create table if not exists attendance_events (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  label text not null,
  person_id text,
  score double precision not null default 0,
  ts timestamptz not null
);

-- App config per org
create table if not exists app_config_main (
  org_id uuid primary key references organizations(id) on delete cascade,
  -- face_engine
  fe_min_cosine_accept double precision not null default 0.6,
  fe_fun_ws_min_interval double precision not null default 0.10,
  fe_att_ws_min_interval double precision not null default 0.15,
  fe_yunet_score_threshold double precision not null default 0.75,
  fe_yunet_nms_threshold double precision not null default 0.30,
  fe_yunet_top_k integer not null default 5000,
  -- attendance
  att_cooldown_sec integer not null default 4860,
  att_same_day_lock boolean not null default true,
  att_min_cosine_accept double precision not null default 0.6,
  att_double_mark_interval_sec integer not null default 0,
  att_grace_in_min integer not null default 10,
  att_grace_out_min integer not null default 5,
  updated_at timestamptz not null default now()
);

create table if not exists attendance_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  day text not null,
  label text,
  enabled boolean not null default true,
  check_in text,
  check_out text,
  grace_in_min integer,
  grace_out_min integer,
  notes text,
  unique (org_id, day)
);

create table if not exists attendance_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  label text,
  enabled boolean not null default true,
  check_in text,
  check_out text,
  grace_in_min integer,
  grace_out_min integer,
  notes text
);

create type if not exists attendance_target_type as enum ('person', 'group');

create table if not exists attendance_override_targets (
  id uuid primary key default gen_random_uuid(),
  override_id uuid not null references attendance_overrides(id) on delete cascade,
  target_type attendance_target_type not null,
  person_id text references persons(person_id) on delete cascade,
  group_id uuid references groups(id) on delete cascade,
  check (
    (target_type = 'person' and person_id is not null and group_id is null)
    or (target_type = 'group' and group_id is not null and person_id is null)
  )
);

create table if not exists user_passwords (
  org_id uuid not null references organizations(id) on delete cascade,
  username text not null,
  salt text not null,
  hash text not null,
  set_at timestamptz not null default now(),
  set_by text,
  primary key (org_id, username)
);

-- Billing (provider-agnostic; Stripe by default)
create table if not exists billing_customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null default 'stripe',
  customer_id text not null,
  plan text,
  status text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, customer_id)
);

create table if not exists billing_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null default 'stripe',
  invoice_id text not null,
  amount integer not null,
  currency text not null default 'usd',
  status text not null default 'open',
  due_date timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, invoice_id)
);

-- Store face watcher index (no JSON file)
create table if not exists face_watch_index (
  org_id uuid not null references organizations(id) on delete cascade,
  path text not null,
  mtime double precision not null default 0,
  primary key (org_id, path)
);
