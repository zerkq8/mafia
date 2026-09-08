import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

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
    if (room.status !== "mafia_recognition") {
      return NextResponse.json({ success: true });
    }

    const startedAt = new Date(room.mafia_recognition_started_at).getTime();
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds < 14) {
      return NextResponse.json({ error: "لسا ما خلصت 15 ثانية." }, { status: 409 });
    }

    if (room.round_number === 1) {
      // الجولة الأولى: بدون قتل — نروح مباشرة لدور الكلام بمتكلم عشوائي
      const { data: aliveNow } = await admin
        .from("online_players")
        .select("id")
        .eq("room_id", room.id)
        .eq("is_alive", true)
        .eq("is_spectator", false);

      const alivePool = aliveNow || [];
      const speaker =
        alivePool.length > 0
          ? alivePool[Math.floor(Math.random() * alivePool.length)]
          : null;

      await admin
        .from("online_rooms")
        .update({
          status: "speaking_turn",
          last_death_player_id: null,
          current_speaker_id: speaker?.id || null,
          speaking_started_at: new Date().toISOString(),
        })
        .eq("id", room.id);
    } else {
      // من الجولة الثانية فصاعدًا: يبدأ القتل الفعلي
      await admin.from("online_rooms").update({ status: "mafia_phase" }).eq("id", room.id);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
