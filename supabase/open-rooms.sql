-- =========================================================
-- MAFIA KUWAIT — قائمة الغرف المفتوحة + تنظيف الغرف المهجورة فعليًا
-- =========================================================
-- نفّذ هذا (يستبدل النسخة القديمة من الدالة)
-- =========================================================

create or replace function list_open_rooms()
returns table (
  code text,
  host_name text,
  current_count int,
  target_count int
)
language sql
security definer
set search_path = public
as $$
  -- تنظيف: احذف غرفة لوبي فقط إذا عمرها أكثر من دقيقة كاملة
  -- وماكو ولا لاعب واحد (بما فيهم الحكم) بعث نبضة حياة خلال آخر 10 دقائق
  -- (مهلة واسعة عمدًا لتفادي حذف غرف فيها ناس فعليًا بس واقفين يتناقشون)
  with cleanup as (
    delete from rooms r
    where r.status = 'lobby'
      and r.created_at < now() - interval '1 minute'
      and not exists (
        select 1 from players p
        where p.room_id = r.id
          and p.last_seen_at > now() - interval '10 minutes'
      )
    returning 1
  )
  select
    r.code,
    (
      select p.name from players p
      where p.room_id = r.id and p.is_host = true
      limit 1
    ) as host_name,
    (
      select count(*)::int from players p2
      where p2.room_id = r.id and p2.is_host = false
    ) as current_count,
    r.target_player_count as target_count
  from rooms r
  where r.status = 'lobby'
  order by r.created_at desc
  limit 30;
$$;

grant execute on function list_open_rooms() to authenticated;
