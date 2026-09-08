-- =========================================================
-- MAFIA KUWAIT — دفعة 7: مؤقتات الليل، لعبة جديدة، رؤية اختيار الشريك، تنظيف الغرف المنتهية
-- =========================================================

-- توقيت بداية كل مرحلة ليلية (لمؤقت 30 ثانية يمنع تجمّد اللعبة لو لاعب انقطع)
alter table online_rooms add column if not exists mafia_phase_started_at timestamptz;
alter table online_rooms add column if not exists detective_phase_started_at timestamptz;
alter table online_rooms add column if not exists doctor_phase_started_at timestamptz;

-- ---------------------------------------------------------
-- RPC: المافيا يشوف اختيار شريكه الحالي لحظيًا (فقط لو هو مافيا)
-- ---------------------------------------------------------
create or replace function get_my_mafia_teammate_pick(p_room_id uuid, p_round int)
returns table (teammate_name text, target_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_my_player_id uuid;
  v_is_mafia boolean;
begin
  select p.id into v_my_player_id
  from online_players p
  where p.room_id = p_room_id and p.auth_id = auth.uid();

  select exists (
    select 1 from online_role_assignments ra
    where ra.room_id = p_room_id and ra.player_id = v_my_player_id and ra.role = 'mafia'
  ) into v_is_mafia;

  if not v_is_mafia then
    return;
  end if;

  return query
    select actor.name, target.name
    from online_night_actions a
    join online_players actor on actor.id = a.actor_player_id
    join online_players target on target.id = a.target_player_id
    join online_role_assignments ra on ra.player_id = a.actor_player_id and ra.room_id = p_room_id
    where a.room_id = p_room_id
      and a.round_number = p_round
      and a.action_type = 'mafia_kill'
      and ra.role = 'mafia'
      and a.actor_player_id <> v_my_player_id;
end;
$$;

-- ---------------------------------------------------------
-- تنظيف الغرف: يشمل الآن الغرف المنتهية والمهجورة أثناء اللعب (مو بس غرف الانتظار)
-- ---------------------------------------------------------
create or replace function list_open_online_rooms()
returns table (code text, active_count bigint, spectator_count bigint, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1) غرف انتظار مهجورة (كل لاعبيها ما نبضوا آخر 10 دقائق)
  delete from online_rooms r
  where r.status = 'waiting'
    and not exists (
      select 1 from online_players p
      where p.room_id = r.id and p.last_seen_at > now() - interval '10 minutes'
    )
    and r.created_at < now() - interval '2 minutes';

  -- 2) غرف منتهية (game_over) عمرها أكثر من 30 دقيقة
  delete from online_rooms r
  where r.status = 'game_over'
    and r.updated_at < now() - interval '30 minutes';

  -- 3) غرف مهجورة أثناء اللعب (كل لاعبيها ما نبضوا آخر 30 دقيقة)
  delete from online_rooms r
  where r.status not in ('waiting', 'game_over')
    and not exists (
      select 1 from online_players p
      where p.room_id = r.id and p.last_seen_at > now() - interval '30 minutes'
    );

  return query
    select
      r.code,
      count(p.id) filter (where p.is_spectator = false) as active_count,
      count(p.id) filter (where p.is_spectator = true) as spectator_count,
      r.created_at
    from online_rooms r
    left join online_players p on p.room_id = r.id
    where r.status = 'waiting'
    group by r.id, r.code, r.created_at
    having count(p.id) filter (where p.is_spectator = false) < 8
    order by r.created_at desc
    limit 20;
end;
$$;

grant execute on function list_open_online_rooms() to authenticated;
grant execute on function get_my_mafia_teammate_pick(uuid, int) to authenticated;
