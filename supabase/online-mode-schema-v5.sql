-- =========================================================
-- MAFIA KUWAIT — إضافات على وضع الأونلاين (دفعة 5)
-- دور كلام كامل بالتناوب (كل الأحياء، واحد ورا الثاني) بدل متكلم عشوائي واحد
-- =========================================================

alter table online_rooms add column if not exists speaking_order jsonb not null default '[]'::jsonb;
alter table online_rooms add column if not exists speaking_index int not null default -1;
