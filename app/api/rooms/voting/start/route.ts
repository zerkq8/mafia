import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { secureShuffle } from "@/lib/secureShuffle";

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
      return NextResponse.json(
        { error: "فقط الحكم يستطيع بدء التصويت." },
        { status: 403 }
      );
    }
    if (room.voting_phase !== "idle") {
      return NextResponse.json({ error: "التصويت جارٍ بالفعل." }, { status: 409 });
    }

    const { data: alivePlayers, error: playersError } = await admin
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .eq("is_host", false)
      .eq("is_alive", true);
    if (playersError) throw playersError;

    const order = secureShuffle((alivePlayers || []).map((p) => p.id));
    if (order.length < 2) {
      return NextResponse.json(
        { error: "يحتاج التصويت لاعبين اثنين أحياء على الأقل." },
        { status: 409 }
      );
    }

    // تنظيف احترازي لأصوات قديمة لنفس الجولة (لو صار تصويت سابق بنفس الجولة لأي سبب)
    await admin
      .from("votes")
      .delete()
      .eq("room_id", room.id)
      .eq("round_number", room.round_number);

    const { error: updateError } = await admin
      .from("rooms")
      .update({
        voting_phase: "voting",
        voting_order: order,
        voting_index: 0,
        voting_turn_started_at: new Date().toISOString(),
        voting_result_started_at: null,
        voting_eliminated_player_id: null,
        voting_tie: false,
      })
      .eq("id", room.id);
    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
