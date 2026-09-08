import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

const MAX_PLAYERS = 8;

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode, playerName } = (await req.json()) as {
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
      .from("online_rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "رمز الغرفة غير صحيح." }, { status: 404 });
    }

    const { data: existingPlayer } = await admin
      .from("online_players")
      .select("*")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();
    if (existingPlayer) {
      return NextResponse.json({ room, player: existingPlayer, reconnected: true });
    }

    const { count } = await admin
      .from("online_players")
      .select("*", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("is_spectator", false);

    const willBeSpectator = room.status !== "waiting" || (count ?? 0) >= MAX_PLAYERS;

    const { data: player, error: playerError } = await admin
      .from("online_players")
      .insert({
        room_id: room.id,
        auth_id: authId,
        name: cleanName,
        is_spectator: willBeSpectator,
        is_ready: willBeSpectator, // المستمع ما يحتاج "استعداد"
      })
      .select()
      .single();
    if (playerError) {
      if (playerError.code === "23505") {
        return NextResponse.json(
          { error: "هذا الاسم مستخدم بالفعل بهذي الغرفة." },
          { status: 409 }
        );
      }
      throw playerError;
    }

    return NextResponse.json({ room, player, reconnected: false, isSpectator: willBeSpectator });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
