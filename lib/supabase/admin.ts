import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * عميل السيرفر — يستخدم المفتاح السري (service_role / sb_secret).
 * ⚠️ لا يُستورد هذا الملف أبدًا داخل مكوّن "use client".
 * يُستخدم فقط داخل app/api/**\/route.ts (Route Handlers) التي تعمل على السيرفر.
 */
export function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "متغيرات البيئة SUPABASE_SECRET_KEY أو NEXT_PUBLIC_SUPABASE_URL غير مضبوطة."
    );
  }

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * يتحقق من هوية الطالب عبر access token المُرسل من المتصفح،
 * ويرجع auth_id الحقيقي بدل الوثوق بأي شيء يرسله العميل مباشرة.
 */
export async function getAuthIdFromRequest(req: Request): Promise<string> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    throw new Error("غير مصرح: لا يوجد رمز جلسة.");
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("غير مصرح: جلسة غير صالحة.");
  }

  return data.user.id;
}
