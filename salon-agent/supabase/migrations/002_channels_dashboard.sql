-- Phase 2 + 3 additions. Idempotent.

-- Telegram sends an update again if we answer slowly; remember which ones we handled.
create table if not exists telegram_updates (
  update_id  bigint primary key,
  created_at timestamptz not null default now()
);
alter table telegram_updates enable row level security;

-- Owner dashboard login: the Supabase Auth user with this email manages the salon.
alter table salons add column if not exists owner_email text;
create index if not exists salons_owner_email on salons (lower(owner_email));

-- How a reminder / follow-up went: 'telegram' (pushed), 'web' (shown when the visitor
-- reopens the chat), or 'none' (no way to reach the customer yet, e.g. no SMS provider).
alter table bookings      add column if not exists reminder_channel text;
alter table conversations add column if not exists followup_channel text;

create index if not exists conversations_followup on conversations (last_message_at) where followup_sent_at is null;
create index if not exists bookings_reminder on bookings (starts_at) where reminder_sent_at is null and status = 'confirmed';
