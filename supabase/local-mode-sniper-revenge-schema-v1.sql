-- =========================================================
-- MAFIA KUWAIT — انتقام القناص (يشتغل من قتل ليلي يدوي أو تصويت)
-- نفّذ هذا في Supabase → SQL Editor
-- =========================================================

alter table rooms
  add column if not exists sniper_revenge_phase text not null default 'idle', -- 'idle' | 'choosing' | 'result'
  add column if not exists sniper_revenge_sniper_id uuid references players(id) on delete set null,
  add column if not exists sniper_revenge_started_at timestamptz,
  add column if not exists sniper_revenge_victim_id uuid references players(id) on delete set null,
  add column if not exists sniper_revenge_result_started_at timestamptz;
