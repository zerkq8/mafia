"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/**
 * عميل Supabase للمتصفح — يستخدم Publishable (anon) key فقط.
 * لا يحمل أي صلاحيات حساسة؛ كل شيء محكوم بـ RLS + RPC.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  browserClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "mafia-kuwait-auth",
      },
    }
  );

  return browserClient;
}

/**
 * يضمن وجود جلسة مجهولة (Anonymous Auth) لهذا الجهاز.
 * إذا ما فيه جلسة، ينشئ واحدة تلقائيًا.
 * يُستدعى مرة عند فتح الصفحة الرئيسية.
 */
export async function ensureAnonymousSession() {
  const supabase = getSupabaseBrowserClient();
  const { data: sessionData } = await supabase.auth.getSession();

  if (sessionData.session) {
    return sessionData.session;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error("تعذّر إنشاء جلسة اللاعب: " + error.message);
  }
  return data.session;
}
