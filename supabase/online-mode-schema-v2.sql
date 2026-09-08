-- =========================================================
-- MAFIA KUWAIT — إضافات على وضع الأونلاين (دفعة 2)
-- =========================================================
-- نفّذ هذا بعد online-mode-schema.sql (إضافي، ما يحذف أو يعيد إنشاء شي)
-- =========================================================

-- مرحلة جديدة: كشف الدور (5 ثواني) قبل تعارف المافيا
alter type online_room_status add value if not exists 'role_reveal' before 'mafia_recognition';

-- ---------------------------------------------------------
-- online_rooms: عمود المنشئ + توقيت مرحلة الكشف
-- ---------------------------------------------------------
alter table online_rooms add column if not exists created_by_auth_id uuid;
alter table online_rooms add column if not exists role_reveal_started_at timestamptz;

-- ---------------------------------------------------------
-- online_players: مستمع/متفرج + رقم المقعد
-- ---------------------------------------------------------
alter table online_players add column if not exists is_spectator boolean not null default false;
alter table online_players add column if not exists seat_number int;
alter table online_players add column if not exists seat_side text; -- 'right' | 'left'

-- ---------------------------------------------------------
-- online_chat_messages — دردشة عامة للغرفة (لاعبين + مستمعين)
-- ---------------------------------------------------------
create table if not exists online_chat_messages (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references online_rooms(id) on delete cascade,
  sender_player_id uuid references online_players(id) on delete set null,
  sender_name   text not null,
  message       text not null check (char_length(message) between 1 and 300),
  created_at    timestamptz not null default now()
);

create index if not exists idx_online_chat_room on online_chat_messages (room_id, created_at);

alter table online_chat_messages enable row level security;

-- أي عضو بالغرفة (لاعب أو مستمع) يقدر يقرأ ويكتب — بدون أي معلومة سرية بهذا الجدول أصلًا
create policy online_chat_select on online_chat_messages
  for select using (room_id in (select my_online_room_ids()));

create policy online_chat_insert on online_chat_messages
  for insert with check (
    sender_player_id in (select id from online_players where auth_id = auth.uid())
  );

-- =========================================================
-- تحديث RPC القراءة العامة للاعبين — نستثني رؤية الدور بردّه، بس نضيف حقول جديدة آمنة
-- (لا حاجة لتعديل — العمودين is_spectator وseat_number مو حساسين، already covered
--  بسياسة online_players_select الموجودة أصلاً)
-- =========================================================

-- =========================================================
-- إضافة غير موجودة بالملف الأصلي: تفعيل Realtime على جدول الدردشة
-- =========================================================
-- صفحة اللعب تشترك بـ postgres_changes (INSERT) على online_chat_messages
-- عشان الرسائل توصل لحظيًا — بدون هذا التفعيل الدردشة ما تتحدّث إلا بإعادة تحميل.
-- إذا ظهر خطأ "already member of publication"، تجاهله.
alter publication supabase_realtime add table online_chat_messages;
