-- =========================================================
-- MAFIA KUWAIT — فحص فوز تلقائي للوضع المحلي (لم يكن موجودًا أصلًا)
-- نفّذ هذا في Supabase → SQL Editor
-- =========================================================

alter table rooms
  add column if not exists winner text; -- null | 'mafia' | 'civilians'
