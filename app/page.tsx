"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ROLES, CONFIGURABLE_ROLES, validateRoleCounts, calcCivilianCount, RoleCounts, RoleKey } from "@/lib/roles";
import AvatarPicker from "@/components/AvatarPicker";

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
  const [avatarIndex, setAvatarIndex] = useState(1);
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

  const [poppedRole, setPoppedRole] = useState<string | null>(null);
  const [sparkleKey, setSparkleKey] = useState(0);

  function popIcon(role: string) {
    setPoppedRole(role);
    setSparkleKey((k) => k + 1);
    setTimeout(() => setPoppedRole((r) => (r === role ? null : r)), 500);
  }

  const civilianCount = calcCivilianCount(playerCount, roleCounts);
  const validation = validateRoleCounts(playerCount, roleCounts);
  const mafiaTeamTotal = roleCounts.mafia + roleCounts.mafia_cop + roleCounts.informer;
  const civilianTeamTotal =
    roleCounts.detective + roleCounts.doctor + roleCounts.sniper + civilianCount;
  const overallTotal = mafiaTeamTotal + civilianTeamTotal;
  const overallOutOfRange = overallTotal < 8 || overallTotal > 25;

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
        avatarIndex,
      });
      router.push(`/room/${room.code}`);
    } catch (e: any) {
      setError(e.message);
      setJoiningCode(null);
    }
  }

  return (
    <main
      className="min-h-screen flex flex-col items-center px-0 py-0"
      style={{ background: "#0B0E14" }}
    >
      <div className="w-full max-w-md relative">
        <img
          src="/hero/majlis-hero.jpg"
          alt="ديوانية لعبة المافيا"
          className="w-full object-cover"
          style={{ maxHeight: 260, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}
        />
      </div>

      <div className="flex flex-col items-center px-6 py-5 flex-1 w-full">
      <h1 className="font-display text-5xl mb-2 mt-2" style={{ color: "#C9A227" }}>لعبة المافيا</h1>
      <div className="w-40 h-px mb-6" style={{ background: "#C9A22766" }} />

      {mode === "idle" && (
        <div className="flex items-end justify-center gap-1.5 mb-8 flex-wrap max-w-sm">
          {[
            { role: "mafia", lift: 0 },
            { role: "informer", lift: 10 },
            { role: "mafia_cop", lift: -6 },
            { role: "detective", lift: 8 },
            { role: "doctor", lift: -4 },
            { role: "sniper", lift: 6 },
            { role: "civilian", lift: -8 },
          ].map(({ role, lift }) => (
            <div
              key={role}
              onClick={() => popIcon(role)}
              className={`relative flex items-center justify-center cursor-pointer ${
                poppedRole === role ? "icon-pop" : ""
              }`}
              style={{
                width: 46,
                height: 46,
                transform: poppedRole === role ? undefined : `translateY(${lift}px)`,
              }}
            >
              {poppedRole === role &&
                ["✦", "✧", "✦", "✧"].map((s, i) => (
                  <span
                    key={sparkleKey + "-" + i}
                    className="sparkle text-xs"
                    style={
                      {
                        color: "#C9A227",
                        left: "50%",
                        top: "50%",
                        "--sx": `${[18, -18, 14, -14][i]}px`,
                        "--sy": `${[-22, -20, 20, 18][i]}px`,
                      } as React.CSSProperties
                    }
                  >
                    {s}
                  </span>
                ))}
              <div
                className="rounded-full overflow-hidden flex items-center justify-center w-full h-full"
                style={{
                  background: "#141B26",
                  border: "2px solid #2A3342",
                  boxShadow: "0 4px 10px -4px rgba(0,0,0,0.35)",
                }}
              >
                <img
                  src={`/roles/color-sm/${role}.png`}
                  alt=""
                  width={30}
                  height={30}
                  style={{ objectFit: "contain" }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {mode === "idle" && (
        <div className="w-full max-w-xs flex flex-col gap-3">
          {myActiveRoom && (
            <button
              onClick={goToMyRoom}
              className="rounded-xl py-3 font-bold"
              style={{ background: "#C9A227", color: "#0B0E14" }}
            >
              🔄 الرجوع لغرفتك النشطة
            </button>
          )}
          <button
            onClick={() => setMode("create")}
            className="rounded-xl py-3 font-bold"
            style={{ background: "#C9A227", color: "#0B0E14" }}
          >
            إنشاء غرفة
          </button>
          <button
            onClick={() => setMode("join")}
            className="rounded-xl py-3 font-bold border"
            style={{ borderColor: "#C9A227", color: "#C9A227" }}
          >
            دخول غرفة
          </button>
          <button
            onClick={() => router.push("/online")}
            className="rounded-xl py-3 font-bold"
            style={{ background: "transparent", border: "1px solid #8A93A6", color: "#8A93A6" }}
          >
            🌐 أونلاين
          </button>
        </div>
      )}

      {mode !== "idle" && (
        <div className="w-full max-w-sm flex flex-col gap-4">
          {mode === "join" && <AvatarPicker value={avatarIndex} onChange={setAvatarIndex} />}

          <div>
            <label className="block text-xs mb-1" style={{ color: "#8A93A6" }}>أدخل اسمك</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: "#141B26", border: "1px solid #2A3342", color: "#EDEAE0" }}
              placeholder="مثال: محمد"
            />
          </div>

          {mode === "create" && (
            <>
              <div>
                <label className="block text-xs mb-1" style={{ color: "#8A93A6" }}>
                  عدد اللاعبين: {playerCount}
                </label>
                <input
                  type="range"
                  min={8}
                  max={25}
                  value={playerCount}
                  onChange={(e) => setPlayerCount(Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: "#C9A227" }}
                />
              </div>

              <div className="rounded-xl p-3" style={{ background: "#141B26", border: "1px solid #2A3342" }}>
                <div className="text-xs mb-3" style={{ color: "#8A93A6" }}>توزيع الأدوار</div>
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
                            style={{ background: "#1E2733", color: "#8A93A6" }}
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
                            style={{ background: "#1E2733", color: "#8A93A6" }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div
                    className="flex items-center justify-center gap-2 pt-2 mt-1 text-xs flex-wrap"
                    style={{ borderTop: "1px solid #2A3342" }}
                  >
                    <span style={{ color: "#E05A4A" }}>🔴 المافيا: {mafiaTeamTotal}</span>
                    <span style={{ color: "#5A6270" }}>|</span>
                    <span style={{ color: "#3FA37A" }}>👥 الشعب: {civilianTeamTotal}</span>
                    <span style={{ color: "#5A6270" }}>|</span>
                    <span
                      dir="ltr"
                      style={{ color: overallOutOfRange ? "#E05A4A" : "#8A93A6" }}
                    >
                      الإجمالي: {overallTotal}
                    </span>
                  </div>
                </div>

                {!validation.valid && (
                  <p className="text-[11px] text-center mt-3" style={{ color: "#E05A4A" }}>
                    {validation.message}
                  </p>
                )}
              </div>
            </>
          )}

          {mode === "join" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs" style={{ color: "#8A93A6" }}>الغرف المفتوحة</label>
                <button
                  onClick={loadOpenRooms}
                  className="text-[11px]"
                  style={{ color: "#C9A227" }}
                  type="button"
                >
                  {roomsLoading ? "..." : "تحديث"}
                </button>
              </div>

              {roomsLoading && openRooms.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: "#8A93A6" }}>
                  جارٍ البحث عن غرف...
                </p>
              )}

              {!roomsLoading && openRooms.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: "#8A93A6" }}>
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
                      className="w-full flex items-center justify-between rounded-xl px-4 py-3 text-sm disabled:opacity-40 text-right"
                      style={{ background: "#141B26", border: "1px solid #2A3342" }}
                    >
                      <span className="flex flex-col items-start">
                        <span className="font-bold" style={{ color: "#EDEAE0" }}>
                          غرفة {r.host_name}
                        </span>
                      </span>
                      <span className="text-xs" style={{ color: "#C9A227" }} dir="ltr">
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

          {error && <p className="text-xs text-center" style={{ color: "#E05A4A" }}>{error}</p>}

          {mode === "create" && (
            <button
              disabled={loading || name.trim().length < 2 || !validation.valid}
              onClick={handleCreate}
              className="rounded-xl py-3 font-bold disabled:opacity-50"
              style={{ background: "#C9A227", color: "#0B0E14" }}
            >
              {loading ? "جارٍ التنفيذ..." : "إنشاء"}
            </button>
          )}
          <button onClick={() => setMode("idle")} className="text-xs" style={{ color: "#8A93A6" }}>
            رجوع
          </button>
        </div>
      )}
      </div>
    </main>
  );
}
