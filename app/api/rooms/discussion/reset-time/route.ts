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

    await admin
      .from("rooms")
      .update({
        discussion_turn_started_at: new Date().toISOString(),
        discussion_paused_at: null,
        discussion_total_paused_seconds: 0,
      })
      .eq("id", room.id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
