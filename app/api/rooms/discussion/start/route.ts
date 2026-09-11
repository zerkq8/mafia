import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { startDiscussionPhase } from "@/lib/localDiscussionResolver";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode, selectedPlayerIds } = (await req.json()) as {
      roomCode: string;
      selectedPlayerIds: string[];
    };
    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }
    if (room.host_auth_id !== authId) {
      return NextResponse.json({ error: "فقط الحكم يستطيع بدء النقاش." }, { status: 403 });
    }
    if (room.discussion_phase !== "idle") {
      return NextResponse.json({ error: "النقاش جارٍ بالفعل." }, { status: 409 });
    }

    const ids = Array.from(new Set(selectedPlayerIds || []));
    if (ids.length !== 2) {
      return NextResponse.json(
        { error: "لازم تختار شخصين بالضبط ليكونوا آخر المتحدثين." },
        { status: 400 }
      );
    }

    const { data: alivePlayers, error: playersError } = await admin
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .eq("is_host", false)
      .eq("is_alive", true);
    if (playersError) throw playersError;

    const aliveIds = new Set((alivePlayers || []).map((p) => p.id));
    if (!ids.every((id) => aliveIds.has(id))) {
      return NextResponse.json(
        { error: "الاختيار لازم يكون بين اللاعبين الأحياء بالغرفة." },
        { status: 400 }
      );
    }

    await admin
      .from("rooms")
      .update({ discussion_selected_players: ids })
      .eq("id", room.id);

    await startDiscussionPhase(admin, { ...room, discussion_selected_players: ids }, "a");

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
