import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

const RESULT_SECONDS = 6;

/**
 * يُستدعى من أي عميل متصل — يرجّع الشاشة لوضعها الطبيعي تلقائيًا
 * بعد عرض نتيجة التصويت لمدة كافية.
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
    if (room.voting_phase !== "result") {
      return NextResponse.json({ success: true });
    }
    if (!room.voting_result_started_at) {
      return NextResponse.json({ success: true });
    }

    const elapsedSeconds =
      (Date.now() - new Date(room.voting_result_started_at).getTime()) / 1000;
    if (elapsedSeconds < RESULT_SECONDS - 0.5) {
      return NextResponse.json({ error: "لسا ما خلصت شاشة النتيجة." }, { status: 409 });
    }

    await admin
      .from("rooms")
      .update({
        voting_phase: "idle",
        voting_order: [],
        voting_index: -1,
        voting_turn_started_at: null,
        voting_result_started_at: null,
        voting_eliminated_player_id: null,
        voting_tie: false,
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
