import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { generateRoomCode } from "@/lib/secureShuffle";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const body = await req.json();
    const { hostName, targetPlayerCount } = body as {
      hostName: string;
      targetPlayerCount: number;
    };

    if (!hostName || hostName.trim().length < 2 || hostName.trim().length > 20) {
      return NextResponse.json(
        { error: "اسم اللاعب يجب أن يكون بين 2 و20 حرفًا." },
        { status: 400 }
      );
    }
    if (
      !Number.isInteger(targetPlayerCount) ||
      targetPlayerCount < 10 ||
      targetPlayerCount > 30
    ) {
      return NextResponse.json(
        { error: "عدد اللاعبين يجب أن يكون بين 10 و30." },
        { status: 400 }
      );
    }

    // تنظيف الاسم من أي محتوى HTML/سكربت
    const cleanName = hostName
      .replace(/<[^>]*>/g, "")
      .replace(/[<>"'`]/g, "")
      .trim();

    const admin = getSupabaseAdminClient();
    let code = generateRoomCode();

    // تجنّب أي تصادم نادر برمز الغرفة
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await admin
        .from("rooms")
        .select("id")
        .eq("code", code)
        .maybeSingle();
      if (!existing) break;
      code = generateRoomCode();
    }

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .insert({
        code,
        host_auth_id: authId,
        target_player_count: targetPlayerCount,
        status: "lobby",
      })
      .select()
      .single();

    if (roomError) throw roomError;

    const { data: hostPlayer, error: playerError } = await admin
      .from("players")
      .insert({
        room_id: room.id,
        auth_id: authId,
        name: cleanName,
        is_host: true,
        is_ready: false,
      })
      .select()
      .single();

    if (playerError) throw playerError;

    return NextResponse.json({ room, player: hostPlayer });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
