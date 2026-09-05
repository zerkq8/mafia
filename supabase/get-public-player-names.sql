-- نفّذ هذا في Supabase → SQL Editor
-- الأسماء وحدها ليست معلومة سرية (خصوصًا أثناء النقاش، الكل يعرف الأسماء أصلاً بالديوانية)
-- هذه الدالة تسمح لشاشة التلفزيون بعرض الأسماء حتى لو فُتحت من جهاز لم ينضم للغرفة

create or replace function get_public_player_names(p_room_id uuid)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name from players p
  where p.room_id = p_room_id and p.is_host = false;
$$;

grant execute on function get_public_player_names(uuid) to authenticated;
