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

-- =========================================================
-- إصلاح غير موجود بالملف الأصلي: دردشة الأونلاين معطّلة فعليًا
-- =========================================================
-- اكتشفته أثناء اختبار دردشة غرفة الانتظار (دفعة 4): سياسة الإدراج
-- الأصلية على online_chat_messages (من دفعة 2) تفشل دايمًا —
-- الاستعلام الفرعي المرتبط (correlated subquery) داخل WITH CHECK
-- يستعلم عن online_players، وهذا الجدول نفسه محمي بـ RLS، والتحقق
-- المتداخل ما ينجح. النتيجة: كل رسالة (بغرفة الانتظار أو صفحة اللعب)
-- كانت تُرفض بصمت (42501) بدون أي خطأ ظاهر بالواجهة، من أول دفعة 2.
-- الحل: دالة security definer تتجاوز هذا التعارض، بنفس نمط
-- my_online_room_ids() المستخدم أصلاً بهذا المشروع.
create or replace function is_my_online_player(p_player_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from online_players
    where id = p_player_id and auth_id = auth.uid()
  );
$$;

grant execute on function is_my_online_player(uuid) to authenticated;

drop policy if exists online_chat_insert on online_chat_messages;
create policy online_chat_insert on online_chat_messages
  for insert with check (is_my_online_player(sender_player_id));
