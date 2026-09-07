import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { generateRoomCode } from "@/lib/secureShuffle";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { playerName } = (await req.json()) as { playerName: string };

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
    let code = generateRoomCode();
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await admin
        .from("online_rooms")
        .select("id")
        .eq("code", code)
        .maybeSingle();
      if (!existing) break;
      code = generateRoomCode();
    }

    const { data: room, error: roomError } = await admin
      .from("online_rooms")
      .insert({ code, status: "waiting" })
      .select()
      .single();
    if (roomError) throw roomError;

    const { data: player, error: playerError } = await admin
      .from("online_players")
      .insert({ room_id: room.id, auth_id: authId, name: cleanName })
      .select()
      .single();
    if (playerError) throw playerError;

    return NextResponse.json({ room, player });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
