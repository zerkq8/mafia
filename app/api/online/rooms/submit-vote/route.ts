import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

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
      return NextResponse.json(
        { error: "بس اللاعبون الأحياء يصوتون." },
        { status: 403 }
      );
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

    // تحقق: هل صوّت كل الأحياء (غير المستمعين)؟
    const { data: aliveVoters } = await admin
      .from("online_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("is_alive", true)
      .eq("is_spectator", false);

    const { data: votes } = await admin
      .from("online_day_votes")
      .select("voter_player_id, target_player_id")
      .eq("room_id", room.id)
      .eq("round_number", room.round_number);

    const aliveIds = new Set((aliveVoters || []).map((p) => p.id));
    const votedIds = new Set((votes || []).map((v) => v.voter_player_id));
    const allVoted = [...aliveIds].every((id) => votedIds.has(id));

    if (!allVoted) {
      return NextResponse.json({ success: true, resolved: false });
    }

    // احسم النتيجة
    const counts = new Map<string, number>();
    (votes || []).forEach((v) => {
      counts.set(v.target_player_id, (counts.get(v.target_player_id) || 0) + 1);
    });
    let maxCount = 0;
    let maxTargets: string[] = [];
    counts.forEach((c, id) => {
      if (c > maxCount) {
        maxCount = c;
        maxTargets = [id];
      } else if (c === maxCount) {
        maxTargets.push(id);
      }
    });

    const votedOut = maxTargets.length === 1 ? maxTargets[0] : null;
    if (votedOut) {
      await admin.from("online_players").update({ is_alive: false }).eq("id", votedOut);
    }

    // فحص شرط الفوز
    const { data: aliveAfter } = await admin
      .from("online_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("is_alive", true)
      .eq("is_spectator", false);

    const { data: mafiaAssignments } = await admin
      .from("online_role_assignments")
      .select("player_id")
      .eq("room_id", room.id)
      .eq("role", "mafia");

    const mafiaIds = new Set((mafiaAssignments || []).map((m) => m.player_id));
    const aliveAfterIds = (aliveAfter || []).map((p) => p.id);
    const aliveMafiaCount = aliveAfterIds.filter((id) => mafiaIds.has(id)).length;
    const aliveTotal = aliveAfterIds.length;

    let winner: string | null = null;
    if (aliveMafiaCount === 0) {
      winner = "civilians";
    } else if (aliveMafiaCount === 1 && aliveTotal === 2) {
      winner = "mafia";
    }

    if (winner) {
      await admin
        .from("online_rooms")
        .update({
          status: "game_over",
          winner,
          last_voted_out_player_id: votedOut,
        })
        .eq("id", room.id);
    } else {
      await admin
        .from("online_rooms")
        .update({
          status: "mafia_recognition",
          round_number: room.round_number + 1,
          pending_mafia_target_id: null,
          last_death_player_id: votedOut,
          last_voted_out_player_id: votedOut,
          mafia_recognition_started_at: new Date().toISOString(),
        })
        .eq("id", room.id);
    }

    return NextResponse.json({ success: true, resolved: true, votedOut, winner });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
