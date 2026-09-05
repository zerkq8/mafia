-- نفّذ هذا في Supabase → SQL Editor
-- يصلح خطأ: سياسة RLS لجدول players كانت تستعلم عن نفس الجدول
-- بشكل يسبب تكرارًا ذاتيًا (recursion) فيفشل الاستعلام بصمت.

-- 1) دالة آمنة تتجاوز RLS داخليًا لجلب غرف اللاعب الحالي فقط
create or replace function my_room_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select room_id from players where auth_id = auth.uid();
$$;

-- 2) استبدال السياسة القديمة بواحدة تستخدم الدالة بدل الاستعلام الذاتي
drop policy if exists players_select_same_room on players;

create policy players_select_same_room on players
  for select using (
    room_id in (select my_room_ids())
    or is_room_host(room_id)
  );
