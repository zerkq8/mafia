"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { NeutralPersonIcon } from "@/components/icons/RoleIcon";

const TURN_SECONDS = 10;

interface VoteRow {
  id: string;
  voter_player_id: string;
  target_player_id: string;
  created_at: string;
}

interface PlayerLite {
  id: string;
  name: string;
}

interface Props {
  roomId: string;
  roomCode: string;
  roundNumber: number;
  votingPhase: "voting" | "result";
  votingOrder: string[];
  votingIndex: number;
  votingTurnStartedAt: string | null;
  votingResultStartedAt: string | null;
  eliminatedPlayerId: string | null;
  tie: boolean;
  players: PlayerLite[];
  myPlayerId: string | null;
}

export default function LocalVotingScreen({
  roomId,
  roomCode,
  roundNumber,
  votingPhase,
  votingOrder,
  votingIndex,
  votingTurnStartedAt,
  votingResultStartedAt,
  eliminatedPlayerId,
  tie,
  players,
  myPlayerId,
}: Props) {
  const [tick, setTick] = useState(0);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const nameOf = useCallback(
    (id: string | null) => (id ? players.find((p) => p.id === id)?.name || "لاعب" : ""),
    [players]
  );

  // عدّاد ثانية بثانية للعرض فقط — الحسم الفعلي دايمًا من السيرفر
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // جلب أصوات هذي الجولة + الاشتراك اللحظي بأي صوت جديد
  const loadVotes = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase
      .from("votes")
      .select("id, voter_player_id, target_player_id, created_at")
      .eq("room_id", roomId)
      .eq("round_number", roundNumber)
      .order("created_at", { ascending: true });
    setVotes((data as VoteRow[]) || []);
  }, [roomId, roundNumber]);

  useEffect(() => {
    loadVotes();
  }, [loadVotes]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`local-votes-${roomId}-${roundNumber}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "votes", filter: `room_id=eq.${roomId}` },
        () => loadVotes()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, roundNumber, loadVotes]);

  // نبض دوري يدفع تقدّم الدور/إنهاء شاشة النتيجة — أي جهاز متصل يكفي لتفادي التعليق
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    async function tickServer() {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      const path =
        votingPhase === "voting"
          ? "/api/rooms/voting/advance-turn"
          : "/api/rooms/voting/end-result";
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode }),
      }).catch(() => {});
    }
    const interval = setInterval(tickServer, 2000);
    return () => clearInterval(interval);
  }, [votingPhase, roomCode]);

  async function submitVote(targetId: string) {
    if (submitting) return;
    setSubmitting(true);
    setActionError("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/rooms/voting/submit-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode, targetPlayerId: targetId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "تعذّر تسجيل الصوت.");
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const currentVoterId = votingPhase === "voting" ? votingOrder[votingIndex] : null;
  const isMyTurn = votingPhase === "voting" && !!myPlayerId && currentVoterId === myPlayerId;

  const elapsed = votingTurnStartedAt
    ? (Date.now() - new Date(votingTurnStartedAt).getTime()) / 1000
    : 0;
  const remaining = Math.max(0, Math.ceil(TURN_SECONDS - elapsed));

  const leftCount = Math.ceil(votingOrder.length / 2);
  const leftIds = votingOrder.slice(0, leftCount);
  const rightIds = votingOrder.slice(leftCount);

  function renderColumn(ids: string[]) {
    return (
      <div className="flex flex-col gap-2 flex-1">
        {ids.map((id) => {
          const isCurrent = id === currentVoterId;
          const clickable = isMyTurn && id !== myPlayerId;
          return (
            <button
              key={id}
              disabled={!clickable || submitting}
              onClick={() => clickable && submitVote(id)}
              className="flex items-center gap-2 rounded-full px-3 py-2 text-right"
              style={{
                background: isCurrent ? "#C9A22722" : "#141B26",
                border: `1px solid ${isCurrent ? "#C9A227" : "#2A3342"}`,
                cursor: clickable ? "pointer" : "default",
                opacity: clickable || isCurrent ? 1 : 0.85,
              }}
            >
              <NeutralPersonIcon color={isCurrent ? "#C9A227" : "#8A93A6"} size={20} />
              <span
                className="text-sm flex-1 truncate"
                style={{ color: isCurrent ? "#F5E7BE" : "#EDEAE0" }}
              >
                {nameOf(id)}
              </span>
              {id === myPlayerId && (
                <span className="text-[10px]" style={{ color: "#8A93A6" }}>
                  أنت
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col px-4 py-5 overflow-y-auto"
      style={{ background: "#0B0E14" }}
    >
      <div className="text-center mb-4">
        <div className="text-[11px] tracking-[0.3em] mb-1" style={{ color: "#8A93A6" }}>
          🗳️ التصويت — جولة {roundNumber}
        </div>
      </div>

      {/* بطاقة الحالة الحالية بالوسط */}
      <div
        className="rounded-2xl p-5 mb-4 text-center mx-auto w-full max-w-xs"
        style={{ background: "#141B26", border: "1px solid #2A3342" }}
      >
        {votingPhase === "voting" && (
          <>
            <p className="text-[11px] tracking-[0.2em] mb-2" style={{ color: "#8A93A6" }}>
              {isMyTurn ? "دورك الآن — اضغط على من تشك فيه" : "دور التصويت الحالي"}
            </p>
            <p className="text-xl font-bold mb-2" style={{ color: "#EDEAE0" }}>
              {nameOf(currentVoterId)}
            </p>
            <p
              dir="ltr"
              className="text-4xl font-display mb-1"
              style={{ color: remaining <= 3 ? "#E05A4A" : "#C9A227" }}
            >
              {remaining}s
            </p>
            <p className="text-[11px]" style={{ color: "#5A6270" }}>
              الدور {votingIndex + 1} من {votingOrder.length}
            </p>
          </>
        )}
        {votingPhase === "result" && (
          <>
            {tie ? (
              <p className="text-2xl font-extrabold py-3" style={{ color: "#8A93A6" }}>
                🤝 تعادل — محد طلع
              </p>
            ) : eliminatedPlayerId ? (
              <p className="text-2xl font-extrabold py-3" style={{ color: "#E05A4A" }}>
                🔪 {nameOf(eliminatedPlayerId)} طُرد
              </p>
            ) : (
              <p className="text-2xl font-extrabold py-3" style={{ color: "#8A93A6" }}>
                🤝 محد طلع
              </p>
            )}
          </>
        )}
      </div>

      {actionError && (
        <p className="text-xs text-center mb-3" style={{ color: "#E05A4A" }}>
          {actionError}
        </p>
      )}

      {/* مجموعتين يمين ويسار — بدون أي كشف لدور أو فريق */}
      <div className="flex gap-3 max-w-md mx-auto w-full mb-4">
        {renderColumn(rightIds)}
        {renderColumn(leftIds)}
      </div>

      {/* قائمة الأصوات المتراكمة لحظيًا */}
      {votes.length > 0 && (
        <div
          className="rounded-xl p-3 max-w-md mx-auto w-full"
          style={{ background: "#0F141C", border: "1px solid #1E2733" }}
        >
          <div className="flex flex-col gap-1">
            {votes.map((v) => (
              <p key={v.id} className="text-xs" style={{ color: "#8A93A6" }}>
                {nameOf(v.voter_player_id)} صوّت على {nameOf(v.target_player_id)}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
