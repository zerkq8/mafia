import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { maybeTriggerSniperRevenge } from "@/lib/sniperRevenge";

/**
 * يحسم تصويت الوضع المحلي: يحسب أكثر لاعب أخذ أصوات، يطبّق الإخراج
 * (نفس آلية toggleAlive بلوحة الحكم)، وينتقل لشاشة النتيجة.
 * يُستخدم من مكانين: submit-vote (لما يصوّت آخر لاعب) وadvance-turn (لما ينتهي وقت آخر دور بدون تصويت).
 */
export async function resolveLocalVote(admin: SupabaseClient, room: any) {
  const { data: votes } = await admin
    .from("votes")
    .select("voter_player_id, target_player_id")
    .eq("room_id", room.id)
    .eq("round_number", room.round_number);

  const counts = new Map<string, number>();
  (votes || []).forEach((v: any) => {
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

  const eliminated = maxCount > 0 && maxTargets.length === 1 ? maxTargets[0] : null;
  const tie = maxCount > 0 && maxTargets.length > 1;

  if (eliminated) {
    const { data: eliminatedPlayer } = await admin
      .from("players")
      .select("name")
      .eq("id", eliminated)
      .maybeSingle();

    await admin.from("players").update({ is_alive: false }).eq("id", eliminated);

    await admin.from("game_events").insert({
      room_id: room.id,
      round_number: room.round_number,
      event_type: "vote_kill",
      payload: { player_id: eliminated, player_name: eliminatedPlayer?.name || "" },
      gm_only: false,
    });
  }

  // حارس ضد سباق نادر بين آخر submit-vote وadvance-turn لنفس الدور الأخير
  await admin
    .from("rooms")
    .update({
      voting_phase: "result",
      voting_index: (room.voting_order || []).length,
      voting_turn_started_at: null,
      voting_result_started_at: new Date().toISOString(),
      voting_eliminated_player_id: eliminated,
      voting_tie: tie,
    })
    .eq("id", room.id)
    .eq("voting_index", room.voting_index);

  // لو المطرود قناص، شغّل دور الانتقام — شاشته تأخذ أولوية العرض فوق نتيجة التصويت
  if (eliminated) {
    await maybeTriggerSniperRevenge(admin, room.id, room.round_number, eliminated);
  }

  return { eliminated, tie };
}
