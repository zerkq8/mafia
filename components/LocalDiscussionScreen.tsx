"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { NeutralPersonIcon } from "@/components/icons/RoleIcon";
import { computeDiscussionRemaining, DISCUSSION_DURATIONS } from "@/lib/discussionTiming";

const PHASE_LABEL: Record<"a" | "b" | "c", string> = {
  a: "المرحلة الأولى",
  b: "المرحلة الثانية",
  c: "الشرطيّون",
};

interface PlayerLite {
  id: string;
  name: string;
}

interface Props {
  roomId: string;
  roomCode: string;
  roundNumber: number;
  phase: "a" | "b" | "c";
  order: string[];
  index: number;
  turnStartedAt: string | null;
  pausedAt: string | null;
  totalPausedSeconds: number;
  players: PlayerLite[];
  myPlayerId: string | null;
  isHost: boolean;
}

export default function LocalDiscussionScreen({
  roomCode,
  roundNumber,
  phase,
  order,
  index,
  turnStartedAt,
  pausedAt,
  totalPausedSeconds,
  players,
  myPlayerId,
  isHost,
}: Props) {
  const [tick, setTick] = useState(0);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const nameOf = useCallback(
    (id: string | null) => (id ? players.find((p) => p.id === id)?.name || "لاعب" : ""),
    [players]
  );

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function callApi(path: string, extra?: Record<string, unknown>) {
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return null;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomCode, ...(extra || {}) }),
    });
    return res.json().catch(() => ({}));
  }

  // نبض دوري يدفع التقدّم التلقائي لما ينتهي الوقت — أي جهاز متصل يكفي
  useEffect(() => {
    if (pausedAt) return;
    const interval = setInterval(() => {
      callApi("/api/rooms/discussion/next").catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, pausedAt]);

  const currentSpeakerId = order[index];
  const isMyTurn = !!myPlayerId && myPlayerId === currentSpeakerId;
  const canPressNext = isMyTurn || isHost;

  const remaining = Math.ceil(
    computeDiscussionRemaining({
      phase,
      turnStartedAt,
      pausedAt,
      totalPausedSeconds,
    })
  );
  const duration = DISCUSSION_DURATIONS[phase];

  async function pressNext() {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      const json = await callApi("/api/rooms/discussion/next", { force: true });
      if (json && json.error) setActionError(json.error);
    } finally {
      setBusy(false);
    }
  }

  async function pressPauseResume() {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      const json = await callApi("/api/rooms/discussion/pause-resume");
      if (json && json.error) setActionError(json.error);
    } finally {
      setBusy(false);
    }
  }

  async function pressResetTime() {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      const json = await callApi("/api/rooms/discussion/reset-time");
      if (json && json.error) setActionError(json.error);
    } finally {
      setBusy(false);
    }
  }

  const leftCount = Math.ceil(order.length / 2);
  const leftIds = order.slice(0, leftCount);
  const rightIds = order.slice(leftCount);

  function renderColumn(ids: string[]) {
    return (
      <div className="flex flex-col gap-2 flex-1">
        {ids.map((id) => {
          const isCurrent = id === currentSpeakerId;
          return (
            <div
              key={id}
              className="flex items-center gap-2 rounded-full px-3 py-2 text-right"
              style={{
                background: isCurrent ? "#C9A22722" : "#141B26",
                border: `1px solid ${isCurrent ? "#C9A227" : "#2A3342"}`,
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
            </div>
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
          🎙️ إدارة النقاش — جولة {roundNumber}
        </div>
        <div className="text-sm font-bold" style={{ color: "#C9A227" }}>
          {PHASE_LABEL[phase]}
        </div>
      </div>

      <div
        className="rounded-2xl p-5 mb-4 text-center mx-auto w-full max-w-xs"
        style={{ background: "#141B26", border: "1px solid #2A3342" }}
      >
        <p className="text-[11px] tracking-[0.2em] mb-2" style={{ color: "#8A93A6" }}>
          {pausedAt ? "متوقف مؤقتًا" : isMyTurn ? "دورك الآن بالكلام" : "المتكلم الحالي"}
        </p>
        <p className="text-xl font-bold mb-2" style={{ color: "#EDEAE0" }}>
          {nameOf(currentSpeakerId)}
        </p>
        <p
          dir="ltr"
          className="text-4xl font-display mb-1"
          style={{ color: remaining <= 10 ? "#E05A4A" : "#C9A227" }}
        >
          {Math.floor(remaining / 60)}:{String(Math.max(0, remaining % 60)).padStart(2, "0")}
        </p>
        <p className="text-[11px]" style={{ color: "#5A6270" }}>
          الدور {index + 1} من {order.length} — {duration} ثانية لكل واحد
        </p>
      </div>

      {actionError && (
        <p className="text-xs text-center mb-3" style={{ color: "#E05A4A" }}>
          {actionError}
        </p>
      )}

      <div className="flex gap-3 max-w-md mx-auto w-full mb-4">
        {renderColumn(rightIds)}
        {renderColumn(leftIds)}
      </div>

      {canPressNext && (
        <button
          onClick={pressNext}
          disabled={busy}
          className="w-full max-w-xs mx-auto rounded-full py-3 text-sm font-bold mb-3 disabled:opacity-50"
          style={{ background: "#C9A227", color: "#0B0E14" }}
        >
          التالي ⏭️
        </button>
      )}

      {isHost && (
        <div className="flex gap-2 max-w-xs mx-auto w-full">
          <button
            onClick={pressPauseResume}
            disabled={busy}
            className="flex-1 rounded-full py-2.5 text-xs font-bold disabled:opacity-50"
            style={{ background: "transparent", border: "1px solid #2A3342", color: "#8A93A6" }}
          >
            {pausedAt ? "▶ استئناف" : "⏸ إيقاف"}
          </button>
          <button
            onClick={pressResetTime}
            disabled={busy}
            className="flex-1 rounded-full py-2.5 text-xs font-bold disabled:opacity-50"
            style={{ background: "transparent", border: "1px solid #2A3342", color: "#8A93A6" }}
          >
            🔄 إعادة الوقت
          </button>
        </div>
      )}
    </div>
  );
}
