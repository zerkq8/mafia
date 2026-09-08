-- =========================================================
-- MAFIA KUWAIT — إضافات على وضع الأونلاين (دفعة 4)
-- =========================================================

-- ---------------------------------------------------------
-- قائمة الغرف الأونلاين المفتوحة (بحالة انتظار، فيها مقاعد فاضية)
-- تنظّف الغرف المهجورة تلقائيًا كل ما تُستدعى (نفس مبدأ الوضع المحلي)
-- ---------------------------------------------------------
create or replace function list_open_online_rooms()
returns table (code text, active_count bigint, spectator_count bigint, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- احذف الغرف المهجورة: بحالة انتظار، وآخر نبضة حياة لأي لاعب فيها أقدم من 10 دقائق
  -- (أو الغرفة فاضية تمامًا وعمرها أكثر من دقيقتين)
  delete from online_rooms r
  where r.status = 'waiting'
    and not exists (
      select 1 from online_players p
      where p.room_id = r.id and p.last_seen_at > now() - interval '10 minutes'
    )
    and r.created_at < now() - interval '2 minutes';

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
