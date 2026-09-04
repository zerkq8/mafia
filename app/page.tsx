"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ROLES, CONFIGURABLE_ROLES, validateRoleCounts, calcCivilianCount, RoleCounts, RoleKey } from "@/lib/roles";

interface OpenRoom {
  code: string;
  host_name: string;
  current_count: number;
  target_count: number;
}

const DEFAULT_COUNTS: RoleCounts = {
  mafia: 1,
  informer: 0,
  mafia_cop: 0,
  detective: 1,
  doctor: 0,
  sniper: 0,
};

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"idle" | "create" | "join">("idle");
  const [playerCount, setPlayerCount] = useState(10);
  const [roleCounts, setRoleCounts] = useState<RoleCounts>(DEFAULT_COUNTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openRooms, setOpenRooms] = useState<OpenRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [myActiveRoom, setMyActiveRoom] = useState<{
    code: string;
    status: string;
    isHost: boolean;
  } | null>(null);

  // اكتشاف تلقائي: هل هذا الجهاز عضو بغرفة نشطة من قبل؟ (بدون رموز)
  useEffect(() => {
    (async () => {
      try {
        const session = await ensureAnonymousSession();
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase
          .from("players")
          .select("is_host, created_at, rooms!inner(code, status)")
          .eq("auth_id", session?.user.id)
          .order("created_at", { ascending: false })
          .limit(1);

        const row = data?.[0] as any;
        const r = row?.rooms
          ? Array.isArray(row.rooms)
            ? row.rooms[0]
            : row.rooms
          : null;

        if (r && r.status !== "game_over") {
          setMyActiveRoom({ code: r.code, status: r.status, isHost: row.is_host });
        }
      } catch {
        // تجاهل بصمت — مجرد فحص اختياري
      }
    })();
  }, []);

  function goToMyRoom() {
    if (!myActiveRoom) return;
    const { code, status, isHost } = myActiveRoom;
    if (status === "lobby") router.push(`/room/${code}`);
    else router.push(`/room/${code}/${isHost ? "gm" : "role"}`);
  }

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
    if (mode !== "join") return;
    loadOpenRooms();
    const interval = setInterval(loadOpenRooms, 4000);
    return () => clearInterval(interval);
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

  const civilianCount = calcCivilianCount(playerCount, roleCounts);
  const validation = validateRoleCounts(playerCount, roleCounts);

  function updateRoleCount(role: RoleKey, delta: number) {
    setRoleCounts((prev) => {
      const key = role as keyof RoleCounts;
      const next = Math.max(0, (prev[key] || 0) + delta);
      return { ...prev, [key]: next };
    });
  }

  async function handleCreate() {
    if (!validation.valid) return;
    setError("");
    setLoading(true);
    try {
      const { room } = await callApi("/api/rooms/create", {
        hostName: name,
        targetPlayerCount: playerCount,
        roleCounts,
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
          {myActiveRoom && (
            <button
              onClick={goToMyRoom}
              className="rounded-xl py-3 font-bold"
              style={{ background: "#2F6F62", color: "#EDEAE0" }}
            >
              🔄 الرجوع لغرفتك النشطة
            </button>
          )}
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
        <div className="w-full max-w-sm flex flex-col gap-4">
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
            <>
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

              <div className="rounded-xl p-3 bg-panel border border-border">
                <div className="text-xs text-muted mb-3">توزيع الأدوار</div>
                <div className="flex flex-col gap-2">
                  {CONFIGURABLE_ROLES.map((roleKey) => {
                    const def = ROLES[roleKey];
                    const key = roleKey as keyof RoleCounts;
                    return (
                      <div
                        key={roleKey}
                        className="flex items-center justify-between"
                      >
                        <span className="text-sm flex items-center gap-1.5">
                          <span>{def.emoji}</span>
                          <span style={{ color: "#EDEAE0" }}>{def.nameAr}</span>
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => updateRoleCount(roleKey, -1)}
                            className="w-7 h-7 rounded-full text-sm"
                            style={{ background: "#1A2230", color: "#8A93A6" }}
                          >
                            −
                          </button>
                          <span
                            dir="ltr"
                            className="w-4 text-center text-sm font-bold"
                            style={{ color: "#C9A227" }}
                          >
                            {roleCounts[key]}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateRoleCount(roleKey, 1)}
                            className="w-7 h-7 rounded-full text-sm"
                            style={{ background: "#1A2230", color: "#8A93A6" }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-border">
                    <span className="text-sm flex items-center gap-1.5">
                      <span>👥</span>
                      <span style={{ color: "#EDEAE0" }}>الشعب</span>
                    </span>
                    <span
                      dir="ltr"
                      className="text-sm font-bold"
                      style={{ color: civilianCount < 0 ? "#8B2635" : "#3FA37A" }}
                    >
                      {civilianCount}
                    </span>
                  </div>
                </div>

                {!validation.valid && (
                  <p className="text-mafia text-[11px] text-center mt-3">
                    {validation.message}
                  </p>
                )}
              </div>
            </>
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
                      </span>
                      <span className="text-xs text-gold" dir="ltr">
                        {joiningCode === r.code
                          ? "..."
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
              disabled={loading || name.trim().length < 2 || !validation.valid}
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
