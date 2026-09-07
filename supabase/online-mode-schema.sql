-- =========================================================
-- MAFIA KUWAIT — وضع الأونلاين (نظام تلقائي بدون حكم بشري)
-- =========================================================
-- منفصل تمامًا عن جداول الوضع المحلي (rooms/players) لتفادي أي تعارض
-- =========================================================

create type online_room_status as enum (
  'waiting', 'mafia_recognition', 'mafia_phase', 'detective_phase', 'doctor_phase',
  'speaking_turn', 'speaking_done'
);

create type online_role_key as enum ('mafia', 'doctor', 'detective', 'civilian');

-- ---------------------------------------------------------
-- online_rooms
-- ---------------------------------------------------------
create table online_rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  status        online_room_status not null default 'waiting',
  round_number  int not null default 0,
  last_death_player_id uuid,
  pending_mafia_target_id uuid,
  mafia_recognition_started_at timestamptz,
  current_speaker_id uuid,
  speaking_started_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_online_rooms_code on online_rooms (code);

-- ---------------------------------------------------------
-- online_players — بدون عمود دور إطلاقًا (الدور بجدول منفصل محمي)
-- ---------------------------------------------------------
create table online_players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references online_rooms(id) on delete cascade,
  auth_id      uuid not null,
  name         text not null check (char_length(name) between 2 and 20),
  is_alive     boolean not null default true,
  is_ready     boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (room_id, name),
  unique (room_id, auth_id)
);

create index idx_online_players_room on online_players (room_id);

-- ---------------------------------------------------------
-- online_role_assignments — الجدول الحساس، بدون أي صلاحية SELECT عامة
-- ---------------------------------------------------------
create table online_role_assignments (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references online_rooms(id) on delete cascade,
  player_id   uuid not null references online_players(id) on delete cascade,
  role        online_role_key not null,
  created_at  timestamptz not null default now(),
  unique (room_id, player_id)
);

-- ---------------------------------------------------------
-- online_night_actions
-- ---------------------------------------------------------
create table online_night_actions (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references online_rooms(id) on delete cascade,
  round_number    int not null,
  action_type     text not null,
  actor_player_id uuid not null references online_players(id) on delete cascade,
  target_player_id uuid references online_players(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (room_id, round_number, action_type, actor_player_id)
);

-- ---------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------
-- ملاحظة: هذي الدالة مو معرّفة بأي ملف تتبعه بمجلد supabase/ الحالي.
-- create or replace آمنة تُنفَّذ حتى لو كانت الدالة موجودة أصلاً بقاعدة البيانات الحية.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_online_rooms_updated_at
before update on online_rooms
for each row execute function set_updated_at();

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table online_rooms enable row level security;
alter table online_players enable row level security;
alter table online_role_assignments enable row level security;
alter table online_night_actions enable row level security;

create policy online_rooms_select on online_rooms
  for select using (auth.role() = 'authenticated');

create or replace function my_online_room_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select room_id from online_players where auth_id = auth.uid();
$$;

-- اللاعبون يشوفون بعض (الاسم، الجاهزية، الحياة) — بدون أي عمود دور بهذا الجدول أصلاً
create policy online_players_select on online_players
  for select using (room_id in (select my_online_room_ids()));

create policy online_players_insert_self on online_players
  for insert with check (auth_id = auth.uid());

create policy online_players_update_self on online_players
  for update using (auth_id = auth.uid());

-- online_role_assignments: بدون أي سياسة SELECT للعملاء إطلاقًا
-- القراءة تتم حصرًا عبر دوال RPC أدناه (security definer)
-- ولا سياسة insert/update للعملاء — التعيين يصير فقط من السيرفر (service_role يتجاوز RLS تلقائيًا)

create policy online_night_actions_insert_self on online_night_actions
  for insert with check (
    actor_player_id in (select id from online_players where auth_id = auth.uid())
  );

create policy online_night_actions_select_own on online_night_actions
  for select using (
    actor_player_id in (select id from online_players where auth_id = auth.uid())
  );

-- =========================================================
-- RPC آمنة
-- =========================================================

-- دور اللاعب نفسه فقط
create or replace function get_my_online_role(p_room_id uuid)
returns table (role online_role_key, is_alive boolean)
language sql
stable
security definer
set search_path = public
as $$
  select ra.role, p.is_alive
  from online_role_assignments ra
  join online_players p on p.id = ra.player_id
  where ra.room_id = p_room_id and p.auth_id = auth.uid();
$$;

-- أعضاء فريق المافيا (فقط لو اللاعب نفسه مافيا)
create or replace function get_my_online_mafia_team(p_room_id uuid)
returns table (player_id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_mafia boolean;
begin
  select exists (
    select 1 from online_role_assignments ra
    join online_players p on p.id = ra.player_id
    where ra.room_id = p_room_id and p.auth_id = auth.uid() and ra.role = 'mafia'
  ) into v_is_mafia;

  if not v_is_mafia then
    return;
  end if;

  return query
    select p.id, p.name
    from online_role_assignments ra
    join online_players p on p.id = ra.player_id
    where ra.room_id = p_room_id and ra.role = 'mafia';
end;
$$;

-- نتيجة تحقيق الشرطي — تُقرأ فقط من الشرطي نفسه، لآخر تحقيق بنفس الجولة
create or replace function get_online_investigation_result(p_room_id uuid, p_round int)
returns table (target_name text, target_role online_role_key)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_detective boolean;
begin
  select exists (
    select 1 from online_role_assignments ra
    join online_players p on p.id = ra.player_id
    where ra.room_id = p_room_id and p.auth_id = auth.uid() and ra.role = 'detective'
  ) into v_is_detective;

  if not v_is_detective then
    return;
  end if;

  return query
    select p.name, ra.role
    from online_night_actions a
    join online_players p on p.id = a.target_player_id
    join online_role_assignments ra on ra.player_id = a.target_player_id and ra.room_id = p_room_id
    where a.room_id = p_room_id
      and a.round_number = p_round
      and a.action_type = 'detective_investigate'
      and a.actor_player_id in (
        select id from online_players where room_id = p_room_id and auth_id = auth.uid()
      )
    order by a.created_at desc
    limit 1;
end;
$$;
