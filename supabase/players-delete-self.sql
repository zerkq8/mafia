-- نفّذ هذا في Supabase → SQL Editor

create policy players_delete_self on players
  for delete using (auth_id = auth.uid() and is_host = false);
