import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SNIPER_REVENGE_SECONDS = 20;
export const SNIPER_RESULT_SECONDS = 6;

/**
 * يتحقق هل اللاعب المقتول قناص، وإذا كان كذا يبدأ دور الانتقام
 * (شاشة اختيار بجواله + إعلان محايد للجميع) بدل إكمال اللعبة فورًا.
 * يُستدعى بعد أي قتل فعلي (يدوي من الحكم أو حسم تصويت) — بلا أثر لو مو قناص،
 * وبلا أثر لو دور انتقام سابق لسا جارٍ (يمنع تشغيل مزدوج).
 */
export async function maybeTriggerSniperRevenge(
  admin: SupabaseClient,
  roomId: string,
  roundNumber: number,
  killedPlayerId: string
): Promise<boolean> {
  const { data: room } = await admin
    .from("rooms")
    .select("id, sniper_revenge_phase")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || room.sniper_revenge_phase !== "idle") return false;

  const { data: assignment } = await admin
    .from("role_assignments")
    .select("role")
    .eq("room_id", roomId)
    .eq("player_id", killedPlayerId)
    .eq("round_number", roundNumber)
    .maybeSingle();

  if (!assignment || assignment.role !== "sniper") return false;

  await admin
    .from("rooms")
    .update({
      sniper_revenge_phase: "choosing",
      sniper_revenge_sniper_id: killedPlayerId,
      sniper_revenge_started_at: new Date().toISOString(),
      sniper_revenge_victim_id: null,
      sniper_revenge_result_started_at: null,
    })
    .eq("id", roomId);

  return true;
}

export async function resolveSniperRevenge(
  admin: SupabaseClient,
  room: any,
  targetPlayerId: string | null
): Promise<void> {
  if (targetPlayerId) {
    const { data: target } = await admin
      .from("players")
      .select("name")
      .eq("id", targetPlayerId)
      .maybeSingle();

    await admin.from("players").update({ is_alive: false }).eq("id", targetPlayerId);

    await admin.from("game_events").insert({
      room_id: room.id,
      round_number: room.round_number,
      event_type: "sniper_revenge_kill",
      payload: { player_id: targetPlayerId, player_name: target?.name || "" },
      gm_only: false,
    });
  }

  await admin
    .from("rooms")
    .update({
      sniper_revenge_phase: "result",
      sniper_revenge_victim_id: targetPlayerId,
      sniper_revenge_result_started_at: new Date().toISOString(),
    })
    .eq("id", room.id)
    .eq("sniper_revenge_phase", "choosing");
}
