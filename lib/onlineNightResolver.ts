import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { secureShuffle } from "@/lib/secureShuffle";

/**
 * منطق حسم مراحل الليل — مشترك بين:
 * - night-action (لما يرسل اللاعب فعله)
 * - advance-night-phase (لما ينتهي مؤقت الـ30 ثانية بدون فعل — يمنع تجمّد اللعبة)
 */

/** ينهي مرحلة المافيا: يحسم الهدف بالأغلبية (أو عشوائيًا لو محد صوّت) → مرحلة الشرطي */
export async function resolveMafiaPhase(admin: SupabaseClient, room: any) {
  const { data: mafiaAssignments } = await admin
    .from("online_role_assignments")
    .select("player_id")
    .eq("room_id", room.id)
    .eq("role", "mafia");
  const mafiaIds = new Set((mafiaAssignments || []).map((m) => m.player_id));

  const { data: submissions } = await admin
    .from("online_night_actions")
    .select("target_player_id, created_at")
    .eq("room_id", room.id)
    .eq("round_number", room.round_number)
    .eq("action_type", "mafia_kill")
    .order("created_at", { ascending: true });

  let bestTarget: string | null = null;

  if (submissions && submissions.length > 0) {
    const counts = new Map<string, number>();
    submissions.forEach((s) => {
      counts.set(s.target_player_id, (counts.get(s.target_player_id) || 0) + 1);
    });
    bestTarget = submissions[0].target_player_id;
    let bestCount = 0;
    counts.forEach((c, id) => {
      if (c > bestCount) {
        bestCount = c;
        bestTarget = id;
      }
    });
  } else {
    // محد صوّت (انقطاع) — هدف عشوائي من الأحياء غير المافيا لكي لا تتجمّد اللعبة
    const { data: alive } = await admin
      .from("online_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("is_alive", true)
      .eq("is_spectator", false);
    const candidates = (alive || []).map((p) => p.id).filter((id) => !mafiaIds.has(id));
    if (candidates.length > 0) {
      bestTarget = secureShuffle(candidates)[0];
    }
  }

  await admin
    .from("online_rooms")
    .update({
      status: "detective_phase",
      pending_mafia_target_id: bestTarget,
      detective_phase_started_at: new Date().toISOString(),
    })
    .eq("id", room.id);
}

/** ينهي مرحلة الشرطي (بعد التحقيق أو بدونه) → مرحلة الطبيب */
export async function resolveDetectivePhase(admin: SupabaseClient, room: any) {
  await admin
    .from("online_rooms")
    .update({
      status: "doctor_phase",
      doctor_phase_started_at: new Date().toISOString(),
    })
    .eq("id", room.id);
}

/**
 * ينهي مرحلة الطبيب: يطبّق الموت (إن لم تُحمَ الضحية)، يفحص الفوز،
 * ثم يبني دور كلام كامل أو ينهي اللعبة.
 * protectedId = null يعني الطبيب ما حمى أحد (انقطاع/مهلة)
 */
export async function resolveDoctorPhase(
  admin: SupabaseClient,
  room: any,
  protectedId: string | null
) {
  const { data: freshRoom } = await admin
    .from("online_rooms")
    .select("pending_mafia_target_id")
    .eq("id", room.id)
    .single();

  const mafiaTarget = freshRoom?.pending_mafia_target_id || null;
  const died = mafiaTarget && mafiaTarget !== protectedId ? mafiaTarget : null;

  if (died) {
    await admin.from("online_players").update({ is_alive: false }).eq("id", died);
  }

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
  if (aliveMafiaCount === 0) winner = "civilians";
  else if (aliveMafiaCount === 1 && aliveTotal === 2) winner = "mafia";

  if (winner) {
    await admin
      .from("online_rooms")
      .update({ status: "game_over", winner, last_death_player_id: died })
      .eq("id", room.id);
    return { died, winner };
  }

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

  return { died, winner: null };
}
