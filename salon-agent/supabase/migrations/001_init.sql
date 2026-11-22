-- SalonAgent schema, Phase 1.
-- Run with `npm run db:migrate`, or paste into the Supabase SQL editor.
-- All times are stored as timestamptz (UTC); each salon has its own timezone.

create extension if not exists btree_gist;   -- needed for the double-booking constraint
create extension if not exists pgcrypto;     -- gen_random_uuid()

-- One row per salon / barbershop.
create table if not exists salons (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,               -- used in URLs and DEFAULT_SALON_SLUG
  name          text not null,
  address       text,
  phone         text,                               -- shown to customers for human handoff
  timezone      text not null default 'Europe/Sofia',
  currency      text not null default 'EUR',
  slot_step_min int  not null default 30 check (slot_step_min between 5 and 120),
  min_lead_min  int  not null default 60,           -- earliest booking: now + this many minutes
  max_days_ahead int not null default 60,           -- latest booking: today + this many days
  extra_info    text,                               -- free text the agent may quote (parking, payment...)
  owner_user_id uuid,                               -- Supabase auth user (Phase 3)
  created_at    timestamptz not null default now()
);

create table if not exists services (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references salons(id) on delete cascade,
  name_bg      text not null,
  name_en      text not null,
  duration_min int  not null check (duration_min between 5 and 480),
  price        numeric(8,2) not null check (price >= 0),
  active       boolean not null default true,
  sort_order   int not null default 0
);

create table if not exists staff (
  id        uuid primary key default gen_random_uuid(),
  salon_id  uuid not null references salons(id) on delete cascade,
  name      text not null,
  active    boolean not null default true
);

-- Opening hours per ISO weekday (1 = Monday ... 7 = Sunday). No row = closed that day.
create table if not exists working_hours (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references salons(id) on delete cascade,
  weekday    smallint not null check (weekday between 1 and 7),
  open_time  time not null,
  close_time time not null,
  check (close_time > open_time),
  unique (salon_id, weekday)
);

create table if not exists conversations (
  id               uuid primary key default gen_random_uuid(),
  salon_id         uuid not null references salons(id) on delete cascade,
  channel          text not null default 'web',     -- web | telegram | test
  external_id      text not null,                   -- web session_id, Telegram chat id...
  customer_name    text,
  customer_phone   text,
  handoff          boolean not null default false,
  handoff_reason   text,
  followup_sent_at timestamptz,                     -- missed-lead reminder (Phase 2)
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  unique (salon_id, channel, external_id)
);

create table if not exists bookings (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,            -- short code we tell the customer, e.g. "K7M2QX"
  salon_id         uuid not null references salons(id) on delete cascade,
  staff_id         uuid not null references staff(id),
  service_id       uuid not null references services(id),
  conversation_id  uuid references conversations(id) on delete set null,
  customer_name    text not null,
  customer_phone   text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  price            numeric(8,2) not null,           -- price at booking time (revenue stays correct after price edits)
  status           text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  source           text not null default 'agent' check (source in ('agent','dashboard')),
  reminder_sent_at timestamptz,                     -- 24h reminder (Phase 2)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at),
  -- THE double-booking guard: one barber can never have two confirmed bookings whose
  -- time ranges overlap. '[)' means 10:00-10:30 and 10:30-11:00 do not overlap.
  constraint bookings_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed')
);
create index if not exists bookings_salon_start on bookings (salon_id, starts_at);

-- Full chat history. `content` holds the exact Claude API content blocks (text, tool_use,
-- tool_result, thinking) so a conversation can be replayed to the model unchanged.
create table if not exists messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         jsonb not null,
  text            text,                             -- plain text for the dashboard / search
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv on messages (conversation_id, id);

-- Every tool call the agent makes, for debugging.
create table if not exists tool_calls (
  id              bigint generated always as identity primary key,
  conversation_id uuid references conversations(id) on delete cascade,
  tool            text not null,
  input           jsonb not null,
  output          jsonb,
  is_error        boolean not null default false,
  duration_ms     int,
  created_at      timestamptz not null default now()
);

-- Row Level Security: ON with no policies, so Supabase's public (anon) API can read nothing.
-- The server connects with the database role from DATABASE_URL, which bypasses RLS.
-- Phase 3 adds owner policies for the dashboard.
alter table salons        enable row level security;
alter table services      enable row level security;
alter table staff         enable row level security;
alter table working_hours enable row level security;
alter table conversations enable row level security;
alter table bookings      enable row level security;
alter table messages      enable row level security;
alter table tool_calls    enable row level security;
