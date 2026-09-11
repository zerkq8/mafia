"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { NeutralPersonIcon } from "@/components/icons/RoleIcon";

const REVENGE_SECONDS = 20;

interface PlayerLite {
  id: string;
  name: string;
  is_alive: boolean;
}

interface Props {
  roomCode: string;
  phase: "choosing" | "result";
  sniperId: string | null;
  startedAt: string | null;
  victimId: string | null;
  resultStartedAt: string | null;
  players: PlayerLite[];
  myPlayerId: string | null;
}

export default function LocalSniperRevengeScreen({
  roomCode,
  phase,
  sniperId,
  startedAt,
  victimId,
  players,
  myPlayerId,
}: Props) {
  const [tick, setTick] = useState(0);
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    const interval = setInterval(() => {
      const path =
        phase === "choosing" ? "/api/rooms/sniper/timeout" : "/api/rooms/sniper/end-result";
      callApi(path).catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roomCode]);

  const isSniper = !!myPlayerId && myPlayerId === sniperId;
  const elapsed = startedAt ? (Date.now() - new Date(startedAt).getTime()) / 1000 : 0;
  const remaining = Math.min(REVENGE_SECONDS, Math.max(0, Math.ceil(REVENGE_SECONDS - elapsed)));

  async function submitTarget(id: string) {
    if (submitting) return;
    setSubmitting(true);
    setActionError("");
    try {
      const json = await callApi("/api/rooms/sniper/choose", { targetPlayerId: id });
      if (json && json.error) setActionError(json.error);
    } finally {
      setSubmitting(false);
    }
  }

  const targets = players.filter((p) => p.is_alive && p.id !== sniperId);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col px-4 py-6 overflow-y-auto items-center"
      style={{ background: "#0B0E14" }}
    >
      <div className="text-3xl mb-3">🎯</div>

      {phase === "choosing" && (
        <>
          <p className="text-lg font-extrabold mb-1 text-center" style={{ color: "#E05A4A" }}>
            القناص قد قُتل
          </p>

          {isSniper ? (
            <>
              <p className="text-xs text-center mb-4" style={{ color: "#8A93A6" }}>
                اختر شخصًا واحدًا لتنتقم منه — {remaining} ثانية متبقية
              </p>
              <div className="w-full max-w-xs flex flex-col gap-2">
                {targets.map((p) => (
                  <button
                    key={p.id}
                    disabled={submitting}
                    onClick={() => submitTarget(p.id)}
                    className="flex items-center gap-2 rounded-full px-3 py-2 text-right"
                    style={{ background: "#141B26", border: "1px solid #2A3342" }}
                  >
                    <NeutralPersonIcon color="#8A93A6" size={20} />
                    <span className="text-sm flex-1 truncate" style={{ color: "#EDEAE0" }}>
                      {p.name}
                    </span>
                  </button>
                ))}
              </div>
              {actionError && (
                <p className="text-xs text-center mt-3" style={{ color: "#E05A4A" }}>
                  {actionError}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-center" style={{ color: "#8A93A6" }}>
              القناص بينتقم الحين...
            </p>
          )}
        </>
      )}

      {phase === "result" && (
        <p className="text-xl font-extrabold text-center" style={{ color: "#E05A4A" }}>
          {victimId ? `القناص قتل ${nameOf(victimId)}` : "القناص ما قدر ينتقم"}
        </p>
      )}
    </div>
  );
}
