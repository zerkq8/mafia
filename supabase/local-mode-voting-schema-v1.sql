-- =========================================================
-- MAFIA KUWAIT — نظام تصويت تلقائي للوضع المحلي (بعد النقاش)
-- نفّذ هذا في Supabase → SQL Editor
-- =========================================================
-- ملاحظة: جدول votes موجود مسبقًا (id, room_id, round_number,
-- voter_player_id, target_player_id, created_at) ومُضاف أصلًا لـ
-- publication الـRealtime — لا حاجة لإنشائه من جديد، فقط نضيف RLS.

-- 1) أعمدة جديدة على rooms لتتبّع حالة التصويت
alter table rooms
  add column if not exists voting_phase text not null default 'idle', -- 'idle' | 'voting' | 'result'
  add column if not exists voting_order jsonb not null default '[]'::jsonb, -- ترتيب عشوائي لمعرّفات اللاعبين الأحياء
  add column if not exists voting_index integer not null default -1, -- مين دوره الآن (فهرس داخل voting_order)
  add column if not exists voting_turn_started_at timestamptz, -- بداية دور التصويت الحالي (للتحقق من 10 ثواني من السيرفر)
  add column if not exists voting_result_started_at timestamptz, -- بداية عرض شاشة النتيجة
  add column if not exists voting_eliminated_player_id uuid references players(id) on delete set null,
  add column if not exists voting_tie boolean not null default false;

-- 2) تفعيل RLS على votes + سياسة قراءة لأعضاء نفس الغرفة (تشمل الحكم)
-- الإدراج يصير حصرًا عبر route handlers بمفتاح السيرفر (يتجاوز RLS) — نفس مبدأ حماية submit-vote بالأونلاين
alter table votes enable row level security;

drop policy if exists votes_select_same_room on votes;
create policy votes_select_same_room on votes
  for select using (
    room_id in (select my_room_ids())
  );

-- 3) votes مفعّل بالـRealtime أصلًا (تأكدنا: محاولة إضافته من جديد تعطي
-- "already member of publication" — هذا متوقع وسليم، لا حاجة لأي أمر هنا.
