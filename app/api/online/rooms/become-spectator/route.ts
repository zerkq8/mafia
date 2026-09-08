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
        { error: "ما تقدر تنزل مستمع بعد ما تبدأ اللعبة." },
        { status: 409 }
      );
    }

    const { data: me, error: meError } = await admin
      .from("online_players")
      .select("*")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();
    if (meError || !me) {
      return NextResponse.json({ error: "أنت مو عضو بهذي الغرفة." }, { status: 403 });
    }
    if (me.is_spectator) {
      return NextResponse.json({ error: "أنت مستمع أصلاً." }, { status: 400 });
    }

    const { error: updateError } = await admin
      .from("online_players")
      .update({ is_spectator: true, is_ready: true })
      .eq("id", me.id);
    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
