-- =========================================================
-- MAFIA KUWAIT — إدارة النقاش الجديدة (3 مراحل: عاديين، مختارون، شرطيّون)
-- نفّذ هذا في Supabase → SQL Editor
-- =========================================================
-- تحل هذي الأعمدة محل الاستخدام القديم لـ speaking_order/speaking_index/
-- speaking_turn_started_at/speaking_duration_seconds/last_speaker_ids
-- (الأعمدة القديمة تبقى بقاعدة البيانات بدون حذف، فقط الكود ما يستخدمها بعد الحين).

alter table rooms
  add column if not exists discussion_phase text not null default 'idle', -- 'idle' | 'a' | 'b' | 'c'
  add column if not exists discussion_order jsonb not null default '[]'::jsonb,
  add column if not exists discussion_index integer not null default -1,
  add column if not exists discussion_turn_started_at timestamptz,
  add column if not exists discussion_paused_at timestamptz,
  add column if not exists discussion_total_paused_seconds integer not null default 0,
  add column if not exists discussion_selected_players jsonb not null default '[]'::jsonb;
