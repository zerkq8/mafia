import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { resolveSniperRevenge, SNIPER_REVENGE_SECONDS } from "@/lib/sniperRevenge";

/**
 * نبض دوري من أي عميل متصل — لو خلصت الـ20 ثانية بدون ما يختار القناص،
 * ينهي الدور بدون قتل حد (تخطّي).
 */
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
    if (room.sniper_revenge_phase !== "choosing") {
      return NextResponse.json({ success: true });
    }
    if (!room.sniper_revenge_started_at) {
      return NextResponse.json({ success: true });
    }

    const elapsedSeconds =
      (Date.now() - new Date(room.sniper_revenge_started_at).getTime()) / 1000;
    if (elapsedSeconds < SNIPER_REVENGE_SECONDS - 0.5) {
      return NextResponse.json({ error: "لسا ما خلص وقت الانتقام." }, { status: 409 });
    }

    await resolveSniperRevenge(admin, room, null);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
