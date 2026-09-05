-- نفّذ هذا في Supabase → SQL Editor
-- إذا ظهر خطأ "already member of publication" لأي سطر، تجاهله — يعني كانت مفعّلة أصلاً

alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table game_events;
alter publication supabase_realtime add table votes;
