import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode } = (await req.json()) as { roomCode: string };
    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }
    if (room.host_auth_id !== authId) {
      return NextResponse.json({ error: "فقط الحكم يتحكم بالوقت." }, { status: 403 });
    }
    if (room.discussion_phase === "idle") {
      return NextResponse.json({ error: "لا يوجد نقاش جارٍ الآن." }, { status: 409 });
    }

    if (room.discussion_paused_at) {
      // استئناف: أضف مدة التوقف للإجمالي التراكمي
      // ⚠️ العمود integer — لازم رقم صحيح، وإلا يفشل التحديث بصمت ويضل paused_at عالق للأبد
      const pausedSeconds = Math.round(
        (Date.now() - new Date(room.discussion_paused_at).getTime()) / 1000
      );
      const { error: resumeError } = await admin
        .from("rooms")
        .update({
          discussion_paused_at: null,
          discussion_total_paused_seconds: room.discussion_total_paused_seconds + pausedSeconds,
        })
        .eq("id", room.id);
      if (resumeError) throw resumeError;
    } else {
      // إيقاف
      const { error: pauseError } = await admin
        .from("rooms")
        .update({ discussion_paused_at: new Date().toISOString() })
        .eq("id", room.id);
      if (pauseError) throw pauseError;
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
