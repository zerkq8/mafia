export type DiscussionPhase = "idle" | "a" | "b" | "c";

export const DISCUSSION_DURATIONS: Record<Exclude<DiscussionPhase, "idle">, number> = {
  a: 50,
  b: 50,
  c: 60,
};

/**
 * يحسب الوقت المتبقي لدور النقاش الحالي — نفس المعادلة المستخدمة على السيرفر والعميل:
 * remaining = duration - ((الآن - وقت البداية) - إجمالي وقت التوقف المتراكم)
 * أثناء التوقف الحالي، الفرق (الآن - وقت_بداية_التوقف) يُضاف مؤقتًا فيلغي أثر مرور الوقت — العدّاد يتجمّد فعليًا.
 */
export function computeDiscussionRemaining(params: {
  phase: Exclude<DiscussionPhase, "idle">;
  turnStartedAt: string | null;
  pausedAt: string | null;
  totalPausedSeconds: number;
  nowMs?: number;
}): number {
  const { phase, turnStartedAt, pausedAt, totalPausedSeconds } = params;
  const duration = DISCUSSION_DURATIONS[phase];
  if (!turnStartedAt) return duration;

  const now = params.nowMs ?? Date.now();
  const startedAtMs = new Date(turnStartedAt).getTime();
  const pausedSoFar =
    totalPausedSeconds + (pausedAt ? (now - new Date(pausedAt).getTime()) / 1000 : 0);
  const elapsed = (now - startedAtMs) / 1000 - pausedSoFar;
  return Math.max(0, duration - elapsed);
}
