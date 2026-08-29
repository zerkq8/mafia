"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";

interface OpenRoom {
  code: string;
  host_name: string;
  current_count: number;
  target_count: number;
}

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"idle" | "create" | "join">("idle");
  const [playerCount, setPlayerCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openRooms, setOpenRooms] = useState<OpenRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);

  const loadOpenRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("list_open_rooms");
      if (!error && data) setOpenRooms(data as OpenRoom[]);
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "join") loadOpenRooms();
  }, [mode, loadOpenRooms]);

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

  async function handleJoin(targetCode: string) {
    setError("");
    setJoiningCode(targetCode);
    try {
      const { room } = await callApi("/api/rooms/join", {
        roomCode: targetCode,
        playerName: name,
      });
      router.push(`/room/${room.code}`);
    } catch (e: any) {
      setError(e.message);
      setJoiningCode(null);
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
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted">الغرف المفتوحة</label>
                <button
                  onClick={loadOpenRooms}
                  className="text-[11px] text-gold"
                  type="button"
                >
                  {roomsLoading ? "..." : "تحديث"}
                </button>
              </div>

              {roomsLoading && openRooms.length === 0 && (
                <p className="text-xs text-muted text-center py-4">
                  جارٍ البحث عن غرف...
                </p>
              )}

              {!roomsLoading && openRooms.length === 0 && (
                <p className="text-xs text-muted text-center py-4">
                  لا توجد غرف مفتوحة حاليًا.
                </p>
              )}

              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {openRooms.map((r) => {
                  const full = r.current_count >= r.target_count;
                  return (
                    <button
                      key={r.code}
                      disabled={
                        full || name.trim().length < 2 || joiningCode !== null
                      }
                      onClick={() => handleJoin(r.code)}
                      className="w-full flex items-center justify-between rounded-xl px-4 py-3 text-sm bg-panel border border-border disabled:opacity-40 text-right"
                    >
                      <span className="flex flex-col items-start">
                        <span className="font-bold text-cream">
                          غرفة {r.host_name}
                        </span>
                        <span className="text-[11px] text-muted">
                          {r.code}
                        </span>
                      </span>
                      <span className="text-xs text-gold">
                        {joiningCode === r.code
                          ? "جارٍ الدخول..."
                          : full
                          ? "مكتملة"
                          : `${r.current_count}/${r.target_count}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="text-mafia text-xs text-center">{error}</p>}

          {mode === "create" && (
            <button
              disabled={loading || name.trim().length < 2}
              onClick={handleCreate}
              className="rounded-xl py-3 font-bold bg-gold text-ink disabled:opacity-50"
            >
              {loading ? "جارٍ التنفيذ..." : "إنشاء"}
            </button>
          )}
          <button onClick={() => setMode("idle")} className="text-xs text-muted">
            رجوع
          </button>
        </div>
      )}
    </main>
  );
}
