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
    if (room.status !== "speaking_turn") {
      return NextResponse.json({ success: true });
    }

    const startedAt = new Date(room.speaking_started_at).getTime();
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds < 34) {
      return NextResponse.json({ error: "لسا ما خلص الوقت." }, { status: 409 });
    }

    await admin
      .from("online_rooms")
      .update({ status: "speaking_done" })
      .eq("id", room.id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
