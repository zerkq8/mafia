import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

/**
 * "لعبة جديدة" بعد النهاية — يرجّع الغرفة لحالة الانتظار بنفس اللاعبين،
 * ويمسح كل بيانات الجولة السابقة (الأدوار، أفعال الليل، الأصوات).
 * فقط منشئ الغرفة يقدر يستدعيها، وفقط لما تكون اللعبة منتهية.
 */
export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
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
    if (room.created_by_auth_id !== authId) {
      return NextResponse.json({ error: "فقط منشئ الغرفة يقدر يبدأ لعبة جديدة." }, { status: 403 });
    }
    if (room.status !== "game_over") {
      return NextResponse.json({ error: "اللعبة لسا ما خلصت." }, { status: 409 });
    }

    // امسح بيانات الجولة السابقة (كلها مرتبطة بالغرفة)
    await admin.from("online_role_assignments").delete().eq("room_id", room.id);
    await admin.from("online_night_actions").delete().eq("room_id", room.id);
    await admin.from("online_day_votes").delete().eq("room_id", room.id);

    // أرجع كل اللاعبين للحالة الأولية (بدون طردهم — نفس المجموعة تلعب من جديد)
    await admin
      .from("online_players")
      .update({ is_alive: true, is_ready: false, seat_number: null, seat_side: null })
      .eq("room_id", room.id);

    await admin
      .from("online_rooms")
      .update({
        status: "waiting",
        round_number: 0,
        winner: null,
        last_death_player_id: null,
        last_voted_out_player_id: null,
        pending_mafia_target_id: null,
        current_speaker_id: null,
        speaking_order: [],
        speaking_index: -1,
        role_reveal_started_at: null,
        mafia_recognition_started_at: null,
        speaking_started_at: null,
        day_vote_started_at: null,
        detective_intro_started_at: null,
        day_vote_result_started_at: null,
        mafia_phase_started_at: null,
        detective_phase_started_at: null,
        doctor_phase_started_at: null,
      })
      .eq("id", room.id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
