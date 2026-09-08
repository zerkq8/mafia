import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * يحسم التصويت النهاري: يحسب الأغلبية، يطبّق الموت، يفحص شرط الفوز،
 * وينتقل لشاشة النتيجة (أو نهاية اللعبة مباشرة لو صار فوز).
 * يُستخدم من مكانين: submit-vote (لما يصوّت الجميع) وadvance-vote (لما ينتهي الوقت).
 */
export async function resolveDayVote(admin: SupabaseClient, room: any) {
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

  const votedOut = maxCount > 0 && maxTargets.length === 1 ? maxTargets[0] : null;
  if (votedOut) {
    await admin.from("online_players").update({ is_alive: false }).eq("id", votedOut);
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
      .update({ status: "game_over", winner, last_voted_out_player_id: votedOut })
      .eq("id", room.id);
  } else {
    await admin
      .from("online_rooms")
      .update({
        status: "day_vote_result",
        last_voted_out_player_id: votedOut,
        day_vote_result_started_at: new Date().toISOString(),
      })
      .eq("id", room.id);
  }

  return { votedOut, winner };
}
