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
    if (room.status !== "day_vote_result") {
      return NextResponse.json({ success: true });
    }

    const startedAt = new Date(room.day_vote_result_started_at).getTime();
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds < 7.5) {
      return NextResponse.json({ error: "لسا ما خلصت شاشة النتيجة." }, { status: 409 });
    }

    await admin
      .from("online_rooms")
      .update({
        status: "mafia_recognition",
        round_number: room.round_number + 1,
        pending_mafia_target_id: null,
        mafia_recognition_started_at: new Date().toISOString(),
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
