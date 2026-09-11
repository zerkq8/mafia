import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { SNIPER_RESULT_SECONDS } from "@/lib/sniperRevenge";

export async function POST(req: Request) {
  try {
    await getAuthIdFromRequest(req);
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
    if (room.sniper_revenge_phase !== "result") {
      return NextResponse.json({ success: true });
    }
    if (!room.sniper_revenge_result_started_at) {
      return NextResponse.json({ success: true });
    }

    const elapsedSeconds =
      (Date.now() - new Date(room.sniper_revenge_result_started_at).getTime()) / 1000;
    if (elapsedSeconds < SNIPER_RESULT_SECONDS - 0.5) {
      return NextResponse.json({ error: "لسا ما خلصت شاشة النتيجة." }, { status: 409 });
    }

    await admin
      .from("rooms")
      .update({
        sniper_revenge_phase: "idle",
        sniper_revenge_sniper_id: null,
        sniper_revenge_started_at: null,
        sniper_revenge_victim_id: null,
        sniper_revenge_result_started_at: null,
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
