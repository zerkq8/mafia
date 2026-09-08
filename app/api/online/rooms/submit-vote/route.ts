import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { resolveDayVote } from "@/lib/onlineVoteResolver";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode, targetPlayerId } = (await req.json()) as {
      roomCode: string;
      targetPlayerId: string;
    };
    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("online_rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }
    if (room.status !== "day_vote") {
      return NextResponse.json({ error: "مو وقت التصويت الآن." }, { status: 409 });
    }

    const { data: voter, error: voterError } = await admin
      .from("online_players")
      .select("*")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();
    if (voterError || !voter) {
      return NextResponse.json({ error: "أنت مو عضو بهذي الغرفة." }, { status: 403 });
    }
    if (!voter.is_alive || voter.is_spectator) {
      return NextResponse.json({ error: "بس اللاعبون الأحياء يصوتون." }, { status: 403 });
    }

    const { error: upsertError } = await admin.from("online_day_votes").upsert(
      {
        room_id: room.id,
        round_number: room.round_number,
        voter_player_id: voter.id,
        target_player_id: targetPlayerId,
      },
      { onConflict: "room_id,round_number,voter_player_id" }
    );
    if (upsertError) throw upsertError;

    // تحقق: هل صوّت كل الأحياء (غير المستمعين)؟ لو نعم، احسم فورًا بدون انتظار الـ10 ثواني
    const { data: aliveVoters } = await admin
      .from("online_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("is_alive", true)
      .eq("is_spectator", false);

    const { data: votes } = await admin
      .from("online_day_votes")
      .select("voter_player_id")
      .eq("room_id", room.id)
      .eq("round_number", room.round_number);

    const aliveIds = new Set((aliveVoters || []).map((p) => p.id));
    const votedIds = new Set((votes || []).map((v) => v.voter_player_id));
    const allVoted = [...aliveIds].every((id) => votedIds.has(id));

    if (!allVoted) {
      return NextResponse.json({ success: true, resolved: false });
    }

    const result = await resolveDayVote(admin, room);
    return NextResponse.json({ success: true, resolved: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
