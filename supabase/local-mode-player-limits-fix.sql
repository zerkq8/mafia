-- =========================================================
-- MAFIA KUWAIT — تحديث حدود عدد اللاعبين بجدول rooms إلى 8-25
-- نفّذ هذا في Supabase → SQL Editor
-- =========================================================
-- كان فيه قيد CHECK على target_player_count بالحدود القديمة (10-30) لسا موجود
-- بقاعدة البيانات رغم تحديث تحقق الـAPI — هذا يسبب خطأ 500 عند إنشاء غرفة
-- بعدد لاعبين بين 8 و9 (تحت الحد القديم). هذا يستبدله بالحدود الجديدة.

alter table rooms drop constraint if exists rooms_target_player_count_check;
alter table rooms add constraint rooms_target_player_count_check
  check (target_player_count between 8 and 25);
