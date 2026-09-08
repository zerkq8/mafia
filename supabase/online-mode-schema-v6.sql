-- =========================================================
-- MAFIA KUWAIT — إضافات على وضع الأونلاين (دفعة 6 SQL)
-- =========================================================

-- مرحلتان جديدتان
alter type online_room_status add value if not exists 'detective_intro' after 'mafia_recognition';
alter type online_room_status add value if not exists 'day_vote_result' after 'day_vote';

-- توقيت مرحلة تحقيق الجولة الأولى السريعة (7 ثواني)
alter table online_rooms add column if not exists detective_intro_started_at timestamptz;

-- توقيت شاشة نتيجة التصويت (قبل الجولة الجديدة)
alter table online_rooms add column if not exists day_vote_result_started_at timestamptz;
