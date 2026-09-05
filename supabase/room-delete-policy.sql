-- نفّذ هذا في Supabase → SQL Editor (بعد schema.sql و open-rooms.sql)

create policy rooms_delete_host_only on rooms
  for delete using (auth.uid() = host_auth_id);
