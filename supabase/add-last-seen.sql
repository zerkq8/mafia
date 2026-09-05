-- نفّذ هذا في Supabase → SQL Editor
-- عمود نبضة حياة (heartbeat) — كل جهاز يحدّثه كل ٢٠ ثانية طالما الصفحة مفتوحة
-- يُستخدم لتحديد "ماكو أحد بالغرفة فعليًا" بدل الاعتماد على وجود صف فقط بقاعدة البيانات

alter table players add column if not exists last_seen_at timestamptz not null default now();
