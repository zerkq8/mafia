import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { resolveSniperRevenge } from "@/lib/sniperRevenge";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode, targetPlayerId } = (await req.json()) as {
      roomCode: string;
      targetPlayerId: string;
    };
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
      return NextResponse.json({ error: "لا يوجد انتقام جارٍ الآن." }, { status: 409 });
    }

    const { data: me } = await admin
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();
    if (!me || me.id !== room.sniper_revenge_sniper_id) {
      return NextResponse.json({ error: "ليس دورك." }, { status: 403 });
    }

    if (!targetPlayerId || targetPlayerId === me.id) {
      return NextResponse.json({ error: "هدف غير صالح." }, { status: 400 });
    }

    const { data: target } = await admin
      .from("players")
      .select("id, is_alive, is_host")
      .eq("id", targetPlayerId)
      .eq("room_id", room.id)
      .maybeSingle();
    if (!target || !target.is_alive || target.is_host) {
      return NextResponse.json({ error: "هدف غير صالح." }, { status: 400 });
    }

    await resolveSniperRevenge(admin, room, targetPlayerId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
