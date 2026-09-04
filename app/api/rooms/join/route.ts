import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const body = await req.json();
    const { roomCode, playerName } = body as {
      roomCode: string;
      playerName: string;
    };

    const cleanName = (playerName || "")
      .replace(/<[^>]*>/g, "")
      .replace(/[<>"'`]/g, "")
      .trim();

    if (cleanName.length < 2 || cleanName.length > 20) {
      return NextResponse.json(
        { error: "اسم اللاعب يجب أن يكون بين 2 و20 حرفًا." },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();

    if (roomError || !room) {
      return NextResponse.json({ error: "رمز الغرفة غير صحيح." }, { status: 404 });
    }

    if (room.status !== "lobby") {
      return NextResponse.json(
        { error: "هذه الغرفة بدأت اللعبة بالفعل." },
        { status: 409 }
      );
    }

    // هل اللاعب موجود مسبقًا بنفس الجهاز (إعادة اتصال)؟
    const { data: existingPlayer } = await admin
      .from("players")
      .select("*")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();

    if (existingPlayer) {
      return NextResponse.json({ room, player: existingPlayer, reconnected: true });
    }

    const { count } = await admin
      .from("players")
      .select("*", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("is_host", false);

    if ((count ?? 0) >= room.target_player_count) {
      return NextResponse.json({ error: "الغرفة مكتملة العدد." }, { status: 409 });
    }

    const { data: player, error: playerError } = await admin
      .from("players")
      .insert({
        room_id: room.id,
        auth_id: authId,
        name: cleanName,
        is_host: false,
        is_ready: false,
      })
      .select()
      .single();

    if (playerError) {
      if (playerError.code === "23505") {
        return NextResponse.json(
          { error: "هذا الاسم مستخدم بالفعل في هذه الغرفة." },
          { status: 409 }
        );
      }
      throw playerError;
    }

    return NextResponse.json({ room, player, reconnected: false });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
