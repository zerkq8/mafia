import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAFIA_TEAM_ROLES = new Set(["mafia", "mafia_cop", "informer"]);

/**
 * يفحص شروط فوز الوضع المحلي (ما كانت موجودة أصلًا) ويطبّق النتيجة لو تحقق شرط:
 * - الشعب يفوز لو انتهت المافيا كلها (فريق المافيا = 0).
 * - المافيا يفوز لو عددهم أكثر من الشعب (بنفس تعريف عدّاد توزيع الأدوار).
 * - المافيا يفوز لو بقي بالضبط 1 مافيا و1 شعب (تعادل 1-1).
 *
 * يُستدعى بعد أي موت فعلي (قتل يدوي، حسم تصويت) — أو بعد اكتمال دور انتقام
 * القناص بالكامل لو كان مصدر الموت قناصًا (نفس نمط تأجيل الفحص المستخدم هناك).
 * بلا أثر لو الفوز محسوم أصلًا (لا يُعاد الفحص بعد إعلان الفائز).
 */
export async function checkAndApplyWinCondition(
  admin: SupabaseClient,
  roomId: string,
  roundNumber: number
): Promise<void> {
  const { data: room } = await admin
    .from("rooms")
    .select("id, winner")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || room.winner) return;

  const { data: alivePlayers } = await admin
    .from("players")
    .select("id")
    .eq("room_id", roomId)
    .eq("is_host", false)
    .eq("is_alive", true);
  const aliveIds: string[] = (alivePlayers || []).map((p: any) => p.id);
  if (aliveIds.length === 0) return;

  const { data: assignments } = await admin
    .from("role_assignments")
    .select("player_id, role")
    .eq("room_id", roomId)
    .eq("round_number", roundNumber);
  const roleOf = new Map((assignments || []).map((a: any) => [a.player_id, a.role]));

  let mafiaCount = 0;
  let civilianCount = 0;
  aliveIds.forEach((id) => {
    if (MAFIA_TEAM_ROLES.has(roleOf.get(id))) mafiaCount++;
    else civilianCount++;
  });

  let winner: "mafia" | "civilians" | null = null;
  if (mafiaCount === 0) winner = "civilians";
  else if (mafiaCount > civilianCount) winner = "mafia";
  else if (mafiaCount === 1 && civilianCount === 1) winner = "mafia";

  if (winner) {
    await admin.from("rooms").update({ winner }).eq("id", roomId).is("winner", null);
  }
}
