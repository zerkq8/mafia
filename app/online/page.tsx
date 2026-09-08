"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";

interface OpenRoom {
  code: string;
  active_count: number;
  spectator_count: number;
  created_at: string;
}

export default function OnlineHomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"idle" | "create" | "join">("idle");
  const [loading, setLoading] = useState(false);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openRooms, setOpenRooms] = useState<OpenRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  async function callApi(path: string, payload: object) {
    await ensureAnonymousSession();
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "حدث خطأ.");
    return json;
  }

  async function loadOpenRooms() {
    setLoadingRooms(true);
    try {
      await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.rpc("list_open_online_rooms");
      setOpenRooms((data as OpenRoom[]) || []);
    } finally {
      setLoadingRooms(false);
    }
  }

  useEffect(() => {
    if (mode === "join") {
      loadOpenRooms();
      const interval = setInterval(loadOpenRooms, 5000);
      return () => clearInterval(interval);
    }
  }, [mode]);

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      const { room } = await callApi("/api/online/rooms/create", { playerName: name });
      router.push(`/online/room/${room.code}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(code: string) {
    setError("");
    setJoiningCode(code);
    try {
      const { room } = await callApi("/api/online/rooms/join", {
        roomCode: code,
        playerName: name,
      });
      router.push(`/online/room/${room.code}`);
    } catch (e: any) {
      setError(e.message);
      setJoiningCode(null);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-4">
      <h1 className="font-display text-4xl text-gold mb-1">لعبة المافيا</h1>
      <p className="text-xs text-muted mb-6">الوضع الأونلاين — تجريبي</p>

      {mode === "idle" && (
        <div className="w-full max-w-xs flex flex-col gap-3">
          <button
            onClick={() => setMode("create")}
            className="rounded-xl py-3 font-bold bg-gold text-ink"
          >
            إنشاء غرفة أونلاين
          </button>
          <button
            onClick={() => setMode("join")}
            className="rounded-xl py-3 font-bold border border-gold text-gold"
          >
            دخول غرفة أونلاين
          </button>
        </div>
      )}

      {mode === "create" && (
        <div className="w-full max-w-xs flex flex-col gap-4">
          <div>
            <label className="block text-xs text-muted mb-1">أدخل اسمك</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              className="w-full rounded-xl px-4 py-3 text-sm bg-panel border border-border outline-none focus:border-gold"
            />
          </div>

          {error && <p className="text-mafia text-xs text-center">{error}</p>}

          <button
            disabled={loading || name.trim().length < 2}
            onClick={handleCreate}
            className="rounded-xl py-3 font-bold bg-gold text-ink disabled:opacity-50"
          >
            {loading ? "جارٍ الإنشاء..." : "إنشاء"}
          </button>
          <button onClick={() => setMode("idle")} className="text-xs text-muted">
            رجوع
          </button>
        </div>
      )}

      {mode === "join" && (
        <div className="w-full max-w-xs flex flex-col gap-4">
          <div>
            <label className="block text-xs text-muted mb-1">أدخل اسمك</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              className="w-full rounded-xl px-4 py-3 text-sm bg-panel border border-border outline-none focus:border-gold"
            />
          </div>

          {error && <p className="text-mafia text-xs text-center">{error}</p>}

          <div>
            <p className="text-xs text-muted mb-2">الغرف المفتوحة الآن</p>
            {loadingRooms && openRooms.length === 0 ? (
              <p className="text-xs text-center py-6" style={{ color: "#8B7F68" }}>
                جارٍ البحث عن غرف...
              </p>
            ) : openRooms.length === 0 ? (
              <p className="text-xs text-center py-6" style={{ color: "#8B7F68" }}>
                ما فيه غرف مفتوحة حاليًا — أنشئ وحدة جديدة!
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {openRooms.map((r) => (
                  <button
                    key={r.code}
                    disabled={name.trim().length < 2 || joiningCode !== null}
                    onClick={() => handleJoin(r.code)}
                    className="flex items-center justify-between rounded-xl px-4 py-3 disabled:opacity-50"
                    style={{ background: "#FFFFFF", border: "1px solid #DED4B8" }}
                  >
                    <span dir="ltr" className="font-display text-lg text-gold tracking-widest">
                      {r.code}
                    </span>
                    <span className="text-xs flex items-center gap-2" style={{ color: "#8B7F68" }}>
                      {joiningCode === r.code ? (
                        "جارٍ الدخول..."
                      ) : (
                        <>
                          <span>👤 {r.active_count}/8</span>
                          {r.spectator_count > 0 && <span>👁️ {r.spectator_count}</span>}
                        </>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => setMode("idle")} className="text-xs text-muted">
            رجوع
          </button>
        </div>
      )}

      <p className="text-[11px] text-muted mt-8 max-w-xs text-center">
        8 لاعبين بالضبط لكل غرفة — 2 مافيا، 1 طبيب، 1 شرطي، 4 شعب. اللعبة تدار تلقائيًا بدون حكم.
      </p>
    </main>
  );
}
