import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { secureShuffle } from "@/lib/secureShuffle";
import { resolveMafiaPhase, resolveDetectivePhase, resolveDoctorPhase } from "@/lib/onlineNightResolver";

type ActionType = "mafia_kill" | "doctor_protect" | "detective_investigate";

const PHASE_FOR_ACTION: Record<ActionType, string> = {
  mafia_kill: "mafia_phase",
  detective_investigate: "detective_phase",
  doctor_protect: "doctor_phase",
};

const ROLE_FOR_ACTION: Record<ActionType, string> = {
  mafia_kill: "mafia",
  detective_investigate: "detective",
  doctor_protect: "doctor",
};

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode, actionType, targetPlayerId } = (await req.json()) as {
      roomCode: string;
      actionType: ActionType;
      targetPlayerId: string;
    };

    if (!PHASE_FOR_ACTION[actionType]) {
      return NextResponse.json({ error: "نوع فعل غير صحيح." }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("online_rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }

    // الشرطي يقدر يحقق بمرحلتين: detective_phase العادية، أو detective_intro (الجولة الأولى بس)
    const validPhase =
      actionType === "detective_investigate"
        ? room.status === "detective_phase" || room.status === "detective_intro"
        : room.status === PHASE_FOR_ACTION[actionType];

    if (!validPhase) {
      return NextResponse.json(
        { error: "مو وقت هذا الفعل الآن." },
        { status: 409 }
      );
    }

    const { data: actor, error: actorError } = await admin
      .from("online_players")
      .select("*")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();
    if (actorError || !actor) {
      return NextResponse.json({ error: "أنت مو عضو بهذي الغرفة." }, { status: 403 });
    }

    const { data: actorRole } = await admin
      .from("online_role_assignments")
      .select("role")
      .eq("room_id", room.id)
      .eq("player_id", actor.id)
      .maybeSingle();

    if (!actorRole || actorRole.role !== ROLE_FOR_ACTION[actionType]) {
      return NextResponse.json({ error: "هذا الفعل مو لدورك." }, { status: 403 });
    }
    if (!actor.is_alive) {
      return NextResponse.json({ error: "أنت خارج اللعبة." }, { status: 403 });
    }

    // سجّل الفعل (أو حدّثه لو غيّر رأيه بنفس الجولة)
    const { error: upsertError } = await admin.from("online_night_actions").upsert(
      {
        room_id: room.id,
        round_number: room.round_number,
        action_type: actionType,
        actor_player_id: actor.id,
        target_player_id: targetPlayerId,
      },
      { onConflict: "room_id,round_number,action_type,actor_player_id" }
    );
    if (upsertError) throw upsertError;

    // ---- تحقق من اكتمال المرحلة وتقدّم تلقائيًا ----
    if (actionType === "mafia_kill") {
      const { data: mafiaAssignments } = await admin
        .from("online_role_assignments")
        .select("player_id")
        .eq("room_id", room.id)
        .eq("role", "mafia");

      const mafiaIds = (mafiaAssignments || []).map((m) => m.player_id);
      const { data: aliveMafia } = await admin
        .from("online_players")
        .select("id")
        .in("id", mafiaIds.length ? mafiaIds : ["00000000-0000-0000-0000-000000000000"])
        .eq("is_alive", true);

      const { data: submissions } = await admin
        .from("online_night_actions")
        .select("actor_player_id, target_player_id, created_at")
        .eq("room_id", room.id)
        .eq("round_number", room.round_number)
        .eq("action_type", "mafia_kill")
        .order("created_at", { ascending: true });

      if ((submissions?.length || 0) >= (aliveMafia?.length || 0)) {
        await resolveMafiaPhase(admin, room);
      }
    } else if (actionType === "detective_investigate") {
      if (room.status === "detective_intro") {
        // الجولة الأولى: بعد التحقيق السريع، مباشرة لدور الكلام (بدون طبيب ولا قتل)
        const { data: aliveNow } = await admin
          .from("online_players")
          .select("id")
          .eq("room_id", room.id)
          .eq("is_alive", true)
          .eq("is_spectator", false);

        const order = secureShuffle((aliveNow || []).map((p) => p.id));

        await admin
          .from("online_rooms")
          .update({
            status: "speaking_turn",
            speaking_order: order,
            speaking_index: 0,
            current_speaker_id: order[0] || null,
            speaking_started_at: new Date().toISOString(),
          })
          .eq("id", room.id);
      } else {
        await resolveDetectivePhase(admin, room);
      }
    } else if (actionType === "doctor_protect") {
      await resolveDoctorPhase(admin, room, targetPlayerId);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
