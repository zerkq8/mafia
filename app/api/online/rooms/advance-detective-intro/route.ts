import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { secureShuffle } from "@/lib/secureShuffle";

export async function POST(req: Request) {
  try {
    await getAuthIdFromRequest(req);
    const { roomCode } = (await req.json()) as { roomCode: string };
    const admin = getSupabaseAdminClient();

    const { data: room, error } = await admin
      .from("online_rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (error || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }
    if (room.status !== "detective_intro") {
      return NextResponse.json({ success: true });
    }

    const startedAt = new Date(room.detective_intro_started_at).getTime();
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds < 6.5) {
      return NextResponse.json({ error: "لسا ما خلصت 7 ثواني." }, { status: 409 });
    }

    const { data: aliveNow } = await admin
      .from("online_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("is_alive", true)
      .eq("is_spectator", false);

    const order = secureShuffle((aliveNow || []).map((p) => p.id));

    await admin
      .from("online_rooms")
      .update({
        status: "speaking_turn",
        speaking_order: order,
        speaking_index: 0,
        current_speaker_id: order[0] || null,
        speaking_started_at: new Date().toISOString(),
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
