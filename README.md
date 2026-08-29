# مافيا الكويت — Mafia Kuwait

## الإعداد المحلي

```bash
npm install
cp .env.local.example .env.local   # ثم عبّي القيم الثلاث من Supabase
npm run dev
```

## النشر على Vercel

1. ادفع هذا المجلد كامل إلى مستودع GitHub (`zerkq8/mafia-kuwait`).
2. من Vercel: Import Git Repository → اختر المستودع.
3. أضف متغيرات البيئة الثلاث (من `.env.local.example`) في:
   Vercel → Project → Settings → Environment Variables.
   - `NEXT_PUBLIC_SUPABASE_URL` و `NEXT_PUBLIC_SUPABASE_ANON_KEY` → Production + Preview + Development
   - `SUPABASE_SECRET_KEY` → **بدون** تفعيل "Expose to browser" — هذا متغير سيرفر فقط.
4. اضغط Deploy.

## قبل التشغيل — من داخل Supabase Dashboard

- نفّذ `schema.sql` (تم ✅ إذا وصلت لهذه المرحلة).
- Authentication → Providers → فعّل **Anonymous Sign-ins**.
- Database → Replication → فعّل Realtime على جداول: `rooms`, `players`, `game_events`, `votes`.

## حالة المشروع الحالية (ما تم بناؤه)

- ✅ قاعدة البيانات كاملة + سياسات RLS + دوال RPC آمنة (`schema.sql`)
- ✅ الصفحة الرئيسية: اسم اللاعب + إنشاء/دخول غرفة
- ✅ API: إنشاء غرفة (`/api/rooms/create`)
- ✅ API: الانضمام لغرفة + إعادة الاتصال بنفس الجهاز (`/api/rooms/join`)
- ✅ نظام الأدوار المركزي ومنطق التحقق من الأعداد (`lib/roles.ts`)
- ✅ Shuffle آمن (`lib/secureShuffle.ts`)

## المتبقي (سيُبنى في الرسائل القادمة)

- [ ] صفحة غرفة الانتظار (Lobby) مع Realtime + QR Code
- [ ] لوحة إعداد الأدوار للحكم (Role Config UI)
- [ ] API توزيع الأدوار (Secure Shuffle + `role_assignments`)
- [ ] شاشة كشف الدور بالسحب (مبنية مسبقًا كمعاينة تصميم، ستُدمج بالبيانات الحقيقية)
- [ ] دورة الليل الكاملة (State Machine: مافيا → شرطي → طبيب → نتيجة)
- [ ] التصويت + التعادل + خروج اللاعب + انتقام القناص
- [ ] شروط الفوز + Game Over + إعادة اللعبة
- [ ] لوحة الحكم الكاملة + أدوات الطوارئ + سجل الأحداث
- [ ] Reconnection كامل + مؤقتات Server-side
