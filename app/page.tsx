"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"idle" | "create" | "join">("idle");
  const [roomCode, setRoomCode] = useState("");
  const [playerCount, setPlayerCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function callApi(path: string, payload: object) {
    await ensureAnonymousSession();
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "حدث خطأ.");
    return json;
  }

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      const { room } = await callApi("/api/rooms/create", {
        hostName: name,
        targetPlayerCount: playerCount,
      });
      router.push(`/room/${room.code}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    setError("");
    setLoading(true);
    try {
      const { room } = await callApi("/api/rooms/join", {
        roomCode,
        playerName: name,
      });
      router.push(`/room/${room.code}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      <h1 className="font-display text-5xl text-gold mb-2">مافيا الكويت</h1>
      <div className="w-40 h-px bg-gold/40 mb-6" />

      {mode === "idle" && (
        <div className="w-full max-w-xs flex flex-col gap-3">
          <button
            onClick={() => setMode("create")}
            className="rounded-xl py-3 font-bold bg-gold text-ink"
          >
            إنشاء غرفة
          </button>
          <button
            onClick={() => setMode("join")}
            className="rounded-xl py-3 font-bold border border-gold text-gold"
          >
            دخول غرفة
          </button>
        </div>
      )}

      {mode !== "idle" && (
        <div className="w-full max-w-xs flex flex-col gap-4">
          <div>
            <label className="block text-xs text-muted mb-1">أدخل اسمك</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              className="w-full rounded-xl px-4 py-3 text-sm bg-panel border border-border outline-none focus:border-gold"
              placeholder="مثال: محمد"
            />
          </div>

          {mode === "create" && (
            <div>
              <label className="block text-xs text-muted mb-1">
                عدد اللاعبين: {playerCount}
              </label>
              <input
                type="range"
                min={10}
                max={30}
                value={playerCount}
                onChange={(e) => setPlayerCount(Number(e.target.value))}
                className="w-full accent-gold"
              />
            </div>
          )}

          {mode === "join" && (
            <div>
              <label className="block text-xs text-muted mb-1">رمز الغرفة</label>
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={4}
                className="w-full rounded-xl px-4 py-3 text-sm bg-panel border border-border outline-none focus:border-gold tracking-widest text-center"
                placeholder="Q8M4"
              />
            </div>
          )}

          {error && <p className="text-mafia text-xs text-center">{error}</p>}

          <button
            disabled={loading || name.trim().length < 2}
            onClick={mode === "create" ? handleCreate : handleJoin}
            className="rounded-xl py-3 font-bold bg-gold text-ink disabled:opacity-50"
          >
            {loading ? "جارٍ التنفيذ..." : mode === "create" ? "إنشاء" : "دخول"}
          </button>
          <button onClick={() => setMode("idle")} className="text-xs text-muted">
            رجوع
          </button>
        </div>
      )}
    </main>
  );
}
