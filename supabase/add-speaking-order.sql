-- نفّذ هذا في Supabase → SQL Editor

alter table rooms add column if not exists speaking_order jsonb not null default '[]';
alter table rooms add column if not exists speaking_index int not null default -1;
alter table rooms add column if not exists speaking_turn_started_at timestamptz;
alter table rooms add column if not exists speaking_duration_seconds int not null default 60;
alter table rooms add column if not exists accused_player_id uuid references players(id) on delete set null;
