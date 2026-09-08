import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
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
    if (room.status !== "speaking_turn") {
      return NextResponse.json({ error: "مو وقت الكلام الآن." }, { status: 409 });
    }

    const { data: me } = await admin
      .from("online_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();

    if (!me || me.id !== room.current_speaker_id) {
      return NextResponse.json(
        { error: "بس المتكلم الحالي يقدر يتخطى دوره." },
        { status: 403 }
      );
    }

    const order: string[] = room.speaking_order || [];
    const nextIndex = (room.speaking_index ?? -1) + 1;

    if (nextIndex < order.length) {
      await admin
        .from("online_rooms")
        .update({
          speaking_index: nextIndex,
          current_speaker_id: order[nextIndex],
          speaking_started_at: new Date().toISOString(),
        })
        .eq("id", room.id);
    } else {
      await admin
        .from("online_rooms")
        .update({
          status: "day_vote",
          day_vote_started_at: new Date().toISOString(),
          current_speaker_id: null,
        })
        .eq("id", room.id);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
