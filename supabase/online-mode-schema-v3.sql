-- =========================================================
-- MAFIA KUWAIT — إضافات على وضع الأونلاين (دفعة 3 — التصويت وشروط الفوز)
-- =========================================================
-- نفّذ بعد الدفعتين السابقتين (online-mode-schema.sql + online-mode-schema-v2.sql)
-- =========================================================

-- مراحل جديدة: التصويت النهاري ونهاية اللعبة
alter type online_room_status add value if not exists 'day_vote' after 'speaking_turn';
alter type online_room_status add value if not exists 'game_over' after 'day_vote';

-- ---------------------------------------------------------
-- online_rooms: توقيت التصويت + الفائز
-- ---------------------------------------------------------
alter table online_rooms add column if not exists day_vote_started_at timestamptz;
alter table online_rooms add column if not exists winner text; -- 'mafia' | 'civilians'
alter table online_rooms add column if not exists last_voted_out_player_id uuid;

-- ---------------------------------------------------------
-- online_day_votes — تصويت علني (يشوفه الجميع لحظيًا)
-- ---------------------------------------------------------
create table if not exists online_day_votes (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references online_rooms(id) on delete cascade,
  round_number    int not null,
  voter_player_id uuid not null references online_players(id) on delete cascade,
  target_player_id uuid not null references online_players(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (room_id, round_number, voter_player_id)
);

alter table online_day_votes enable row level security;

-- التصويت علني بالكامل — أي عضو بالغرفة يشوف كل الأصوات (مو سرّي زي أفعال الليل)
drop policy if exists online_day_votes_select on online_day_votes;
create policy online_day_votes_select on online_day_votes
  for select using (room_id in (select my_online_room_ids()));

drop policy if exists online_day_votes_insert_self on online_day_votes;
create policy online_day_votes_insert_self on online_day_votes
  for insert with check (
    voter_player_id in (select id from online_players where auth_id = auth.uid())
  );

-- =========================================================
-- RPC: كشف كل الأدوار — يشتغل فقط لو الغرفة انتهت فعلاً (game_over)
-- =========================================================
create or replace function get_all_online_roles_if_game_over(p_room_id uuid)
returns table (player_id uuid, name text, role online_role_key)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status online_room_status;
begin
  select status into v_status from online_rooms where id = p_room_id;
  if v_status is distinct from 'game_over' then
    return;
  end if;

  return query
    select p.id, p.name, ra.role
    from online_role_assignments ra
    join online_players p on p.id = ra.player_id
    where ra.room_id = p_room_id;
end;
$$;

-- =========================================================
-- إضافة غير موجودة بالملف الأصلي: تفعيل Realtime على جدول التصويت
-- =========================================================
-- صفحة اللعب تشترك بـ postgres_changes على online_day_votes عشان
-- الأصوات تظهر لحظيًا للجميع أثناء التصويت — بدون هذا التفعيل
-- الأصوات ما توصل إلا بإعادة تحميل الصفحة.
-- إذا ظهر خطأ "already member of publication"، تجاهله.
alter publication supabase_realtime add table online_day_votes;
