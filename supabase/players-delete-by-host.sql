-- نفّذ هذا في Supabase → SQL Editor

create policy players_delete_by_host on players
  for delete using (is_room_host(room_id) and is_host = false);
