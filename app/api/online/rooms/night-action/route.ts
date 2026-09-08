import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { secureShuffle } from "@/lib/secureShuffle";

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

    if (room.status !== PHASE_FOR_ACTION[actionType]) {
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
        // نحسم الهدف بالأغلبية، ولو تعادل ناخذ أول اختيار
        const counts = new Map<string, number>();
        (submissions || []).forEach((s) => {
          counts.set(s.target_player_id, (counts.get(s.target_player_id) || 0) + 1);
        });
        let bestTarget = submissions![0].target_player_id;
        let bestCount = 0;
        counts.forEach((c, id) => {
          if (c > bestCount) {
            bestCount = c;
            bestTarget = id;
          }
        });

        await admin
          .from("online_rooms")
          .update({ status: "detective_phase", pending_mafia_target_id: bestTarget })
          .eq("id", room.id);
      }
    } else if (actionType === "detective_investigate") {
      await admin
        .from("online_rooms")
        .update({ status: "doctor_phase" })
        .eq("id", room.id);
    } else if (actionType === "doctor_protect") {
      const { data: freshRoom } = await admin
        .from("online_rooms")
        .select("pending_mafia_target_id")
        .eq("id", room.id)
        .single();

      const mafiaTarget = freshRoom?.pending_mafia_target_id || null;
      const protectedId = targetPlayerId;
      const died = mafiaTarget && mafiaTarget !== protectedId ? mafiaTarget : null;

      if (died) {
        await admin.from("online_players").update({ is_alive: false }).eq("id", died);
      }

      // فحص شرط الفوز — يجب أن يتحقق فورًا بعد القتل الليلي نفسه، مو بس بعد التصويت النهاري
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
            last_death_player_id: died,
          })
          .eq("id", room.id);
        return NextResponse.json({ success: true, winner });
      }

      // لا فوز بعد — ابنِ دور كلام كامل لكل الأحياء (غير المستمعين) بالترتيب
      const order = secureShuffle(aliveAfterIds);

      await admin
        .from("online_rooms")
        .update({
          status: "speaking_turn",
          last_death_player_id: died,
          speaking_order: order,
          speaking_index: 0,
          current_speaker_id: order[0] || null,
          speaking_started_at: new Date().toISOString(),
        })
        .eq("id", room.id);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
