import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode } = (await req.json()) as { roomCode: string };
    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("online_rooms")
      .select("id, status")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }
    if (room.status !== "waiting") {
      return NextResponse.json(
        { error: "ما تقدر تطلع بعد ما تبدأ اللعبة." },
        { status: 409 }
      );
    }

    const { error: delError } = await admin
      .from("online_players")
      .delete()
      .eq("room_id", room.id)
      .eq("auth_id", authId);
    if (delError) throw delError;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
