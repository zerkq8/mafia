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
        { error: "ما تقدر تصعد كلاعب بعد ما تبدأ اللعبة." },
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
    if (!me.is_spectator) {
      return NextResponse.json({ error: "أنت لاعب أصلاً." }, { status: 400 });
    }

    const { count } = await admin
      .from("online_players")
      .select("*", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("is_spectator", false);
    if ((count ?? 0) >= 8) {
      return NextResponse.json({ error: "ما فيه مقاعد فاضية حاليًا." }, { status: 409 });
    }

    const { error: updateError } = await admin
      .from("online_players")
      .update({ is_spectator: false, is_ready: false })
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
