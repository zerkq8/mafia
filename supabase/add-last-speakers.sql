-- نفّذ هذا في Supabase → SQL Editor

alter table rooms add column if not exists last_speaker_ids jsonb not null default '[]'::jsonb;

-- العمود القديم accused_player_id لم يعد يُستخدم بالكود، تُرك بدون حذف (بدون أي ضرر)
