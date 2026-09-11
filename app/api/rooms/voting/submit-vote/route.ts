import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { resolveLocalVote } from "@/lib/localVoteResolver";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode, targetPlayerId } = (await req.json()) as {
      roomCode: string;
      targetPlayerId: string;
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
    if (room.voting_phase !== "voting") {
      return NextResponse.json({ error: "لا يوجد تصويت جارٍ الآن." }, { status: 409 });
    }

    const { data: me } = await admin
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();
    if (!me) {
      return NextResponse.json({ error: "أنت لست لاعبًا بهذه الغرفة." }, { status: 403 });
    }

    const order: string[] = room.voting_order || [];
    const currentIndex: number = room.voting_index;
    const currentVoterId = order[currentIndex];

    if (!currentVoterId || currentVoterId !== me.id) {
      return NextResponse.json({ error: "ليس دورك الآن." }, { status: 409 });
    }
    if (!targetPlayerId || targetPlayerId === me.id || !order.includes(targetPlayerId)) {
      return NextResponse.json({ error: "هدف تصويت غير صالح." }, { status: 400 });
    }

    const { data: existingVote } = await admin
      .from("votes")
      .select("id")
      .eq("room_id", room.id)
      .eq("round_number", room.round_number)
      .eq("voter_player_id", me.id)
      .maybeSingle();
    if (existingVote) {
      return NextResponse.json({ error: "لقد صوّتّ بالفعل هذي الجولة." }, { status: 409 });
    }

    const { error: insertError } = await admin.from("votes").insert({
      room_id: room.id,
      round_number: room.round_number,
      voter_player_id: me.id,
      target_player_id: targetPlayerId,
    });
    if (insertError) throw insertError;

    const nextIndex = currentIndex + 1;
    if (nextIndex >= order.length) {
      await resolveLocalVote(admin, room);
    } else {
      // تحديث مشروط: لو advance-turn سبقنا بنفس اللحظة (سباق نادر)، ما نكرر التقدّم
      await admin
        .from("rooms")
        .update({ voting_index: nextIndex, voting_turn_started_at: new Date().toISOString() })
        .eq("id", room.id)
        .eq("voting_index", currentIndex);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
