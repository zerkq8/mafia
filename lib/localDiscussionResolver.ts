import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { secureShuffle } from "@/lib/secureShuffle";
import type { DiscussionPhase } from "@/lib/discussionTiming";

async function computePhaseOrder(
  admin: SupabaseClient,
  room: any,
  phase: "a" | "b" | "c"
): Promise<string[]> {
  const { data: alivePlayers } = await admin
    .from("players")
    .select("id")
    .eq("room_id", room.id)
    .eq("is_host", false)
    .eq("is_alive", true);
  const aliveIds: string[] = (alivePlayers || []).map((p: any) => p.id);

  const { data: assignments } = await admin
    .from("role_assignments")
    .select("player_id, role")
    .eq("room_id", room.id)
    .eq("round_number", room.round_number);

  const roleOf = new Map((assignments || []).map((a: any) => [a.player_id, a.role]));
  const policemenIds = aliveIds.filter(
    (id) => roleOf.get(id) === "mafia_cop" || roleOf.get(id) === "detective"
  );
  const selected: string[] = room.discussion_selected_players || [];

  if (phase === "a") {
    const excluded = new Set([...selected, ...policemenIds]);
    return secureShuffle(aliveIds.filter((id) => !excluded.has(id)));
  }
  if (phase === "b") {
    const policemenSet = new Set(policemenIds);
    const valid = selected.filter((id) => aliveIds.includes(id) && !policemenSet.has(id));
    return secureShuffle(valid);
  }
  // phase === "c"
  return secureShuffle(policemenIds);
}

function nextPhaseOf(phase: "a" | "b" | "c"): "a" | "b" | "c" | "done" {
  if (phase === "a") return "b";
  if (phase === "b") return "c";
  return "done";
}

/**
 * يبني ترتيب المرحلة المطلوبة ويحدّث الغرفة. لو القائمة فاضية (محد مؤهّل لهذي المرحلة)
 * ينتقل تلقائيًا للمرحلة التالية (بلا توقف مرئي) — حتى الوصول لمرحلة فيها ناس، أو النهاية.
 */
export async function startDiscussionPhase(
  admin: SupabaseClient,
  room: any,
  phase: "a" | "b" | "c" | "done"
): Promise<void> {
  if (phase === "done") {
    await admin
      .from("rooms")
      .update({
        discussion_phase: "idle",
        discussion_order: [],
        discussion_index: -1,
        discussion_turn_started_at: null,
        discussion_paused_at: null,
        discussion_total_paused_seconds: 0,
      })
      .eq("id", room.id);
    return;
  }

  const order = await computePhaseOrder(admin, room, phase);
  if (order.length === 0) {
    await startDiscussionPhase(admin, room, nextPhaseOf(phase));
    return;
  }

  await admin
    .from("rooms")
    .update({
      discussion_phase: phase,
      discussion_order: order,
      discussion_index: 0,
      discussion_turn_started_at: new Date().toISOString(),
      discussion_paused_at: null,
      discussion_total_paused_seconds: 0,
    })
    .eq("id", room.id);
}

export async function advanceToNextDiscussionTurn(
  admin: SupabaseClient,
  room: any
): Promise<void> {
  const order: string[] = room.discussion_order || [];
  const nextIndex = room.discussion_index + 1;

  if (nextIndex < order.length) {
    await admin
      .from("rooms")
      .update({
        discussion_index: nextIndex,
        discussion_turn_started_at: new Date().toISOString(),
        discussion_paused_at: null,
        discussion_total_paused_seconds: 0,
      })
      .eq("id", room.id)
      .eq("discussion_index", room.discussion_index);
    return;
  }

  await startDiscussionPhase(admin, room, nextPhaseOf(room.discussion_phase as "a" | "b" | "c"));
}
