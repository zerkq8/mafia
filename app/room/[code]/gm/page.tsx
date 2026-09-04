"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ensureAnonymousSession,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";
import { ROLES, RoleKey, TeamKey } from "@/lib/roles";

interface RoomRow {
  id: string;
  code: string;
  status: string;
  round_number: number;
  host_auth_id: string;
  speaking_order: string[];
  speaking_index: number;
  speaking_turn_started_at: string | null;
  speaking_duration_seconds: number;
  accused_player_id: string | null;
}

interface PlayerWithRole {
  id: string;
  name: string;
  is_alive: boolean;
  is_ready: boolean;
  role: RoleKey | null;
  team: TeamKey | null;
}

export default function GmDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerWithRole[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showNamesPanel, setShowNamesPanel] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select(
          "id, code, status, round_number, host_auth_id, speaking_order, speaking_index, speaking_turn_started_at, speaking_duration_seconds, accused_player_id"
        )
        .eq("code", code)
        .maybeSingle();

      if (roomError || !roomData) {
        setError("لم يتم العثور على الغرفة.");
        setLoading(false);
        return;
      }
      setRoom(roomData as RoomRow);

      const amHost = roomData.host_auth_id === session?.user.id;
      setIsHost(amHost);
      if (!amHost) {
        setError("هذه الصفحة مخصصة للحكم فقط.");
        setLoading(false);
        return;
      }

      const { data: playersData, error: playersError } = await supabase
        .from("players")
        .select("id, name, is_alive, is_ready, is_host")
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true });
      if (playersError) throw playersError;

      const { data: assignments, error: assignError } = await supabase
        .from("role_assignments")
        .select("player_id, role, team")
        .eq("room_id", roomData.id)
        .eq("round_number", roomData.round_number);
      if (assignError) throw assignError;

      const roleMap = new Map(
        (assignments || []).map((a) => [a.player_id, a])
      );

      const merged = (playersData || [])
        .filter((p) => !p.is_host)
        .map((p) => {
          const a = roleMap.get(p.id);
          return {
            id: p.id,
            name: p.name,
            is_alive: p.is_alive,
            is_ready: p.is_ready,
            role: (a?.role as RoleKey) || null,
            team: (a?.team as TeamKey) || null,
          };
        });

      setPlayers(merged);

      const hostRow = (playersData || []).find((p) => p.is_host);
      if (hostRow) setMyPlayerId(hostRow.id);
    } catch (e: any) {
      setError(e.message || "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  // نبضة حياة للحكم أيضًا
  useEffect(() => {
    if (!myPlayerId) return;
    const supabase = getSupabaseBrowserClient();
    const ping = () => {
      supabase
        .from("players")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", myPlayerId)
        .then(() => {});
    };
    ping();
    heartbeatRef.current = setInterval(ping, 20000);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [myPlayerId]);

  useEffect(() => {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`gm-${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.id}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  async function toggleAlive(player: PlayerWithRole) {
    if (!room) return;
    const willKill = player.is_alive;
    const ok = window.confirm(
      willKill
        ? `هل تريد إخراج "${player.name}" من اللعبة؟`
        : `هل تريد إعادة "${player.name}" للحياة؟`
    );
    if (!ok) return;

    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from("players")
      .update({ is_alive: !player.is_alive })
      .eq("id", player.id);

    if (updateError) {
      setActionError("تعذّر تنفيذ العملية: " + updateError.message);
      return;
    }
    setActionError("");

    await supabase.from("game_events").insert({
      room_id: room.id,
      round_number: room.round_number,
      event_type: willKill ? "gm_kill" : "gm_revive",
      payload: { player_id: player.id, player_name: player.name },
      gm_only: true,
    });
  }

  function shuffleIds(ids: string[]) {
    const arr = [...ids];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async function startDiscussion() {
    if (!room) return;
    const eligible = players
      .filter(
        (p) =>
          p.is_alive && p.role !== "detective" && p.role !== "mafia_cop"
      )
      .map((p) => p.id);

    if (eligible.length === 0) {
      setActionError("لا يوجد لاعبون مؤهلون لبدء النقاش.");
      return;
    }

    const order = shuffleIds(eligible);
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from("rooms")
      .update({
        speaking_order: order,
        speaking_index: 0,
        speaking_turn_started_at: new Date().toISOString(),
        accused_player_id: null,
      })
      .eq("id", room.id);
    if (updateError) setActionError("تعذّر بدء النقاش: " + updateError.message);
    else setActionError("");
  }

  async function nextSpeaker() {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    const nextIndex = room.speaking_index + 1;
    await supabase
      .from("rooms")
      .update({
        speaking_index: nextIndex,
        speaking_turn_started_at:
          nextIndex < room.speaking_order.length
            ? new Date().toISOString()
            : null,
      })
      .eq("id", room.id);
  }

  async function extendTime(deltaSeconds: number) {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    await supabase
      .from("rooms")
      .update({
        speaking_duration_seconds: Math.max(
          10,
          room.speaking_duration_seconds + deltaSeconds
        ),
      })
      .eq("id", room.id);
  }

  async function markAccused(playerId: string) {
    if (!room) return;
    const order = [...(room.speaking_order || [])];
    const idx = order.indexOf(playerId);
    // ينتقل لآخر الدور فقط لو لسا ما تكلم (يظل بمكانه لو تكلم أو يتكلم الحين)
    if (idx > -1 && idx > room.speaking_index) {
      order.splice(idx, 1);
      order.push(playerId);
    }
    const supabase = getSupabaseBrowserClient();
    await supabase
      .from("rooms")
      .update({ speaking_order: order, accused_player_id: playerId })
      .eq("id", room.id);
  }

  function playerName(id: string | null) {
    if (!id) return "";
    return players.find((p) => p.id === id)?.name || "";
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-muted text-sm">
        جارٍ التحميل...
      </main>
    );
  }

  if (error || !room) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-4">
        <p className="text-mafia text-sm text-center">{error}</p>
        <button
          onClick={() => router.push("/")}
          className="text-xs text-gold border border-gold rounded-full px-4 py-2"
        >
          رجوع للرئيسية
        </button>
      </main>
    );
  }

  const aliveCount = players.filter((p) => p.is_alive).length;

  return (
    <main className="min-h-screen px-5 py-8 max-w-md mx-auto">
      <div className="text-center mb-6">
        <div className="text-[10px] tracking-[0.3em] text-muted mb-1">
          👑 لوحة الحكم
        </div>
        <div className="font-display text-2xl text-gold">
          الجولة {room.round_number}
        </div>
        <div dir="ltr" className="text-sm text-muted mt-1">
          الأحياء: {aliveCount}/{players.length}
        </div>
      </div>

      {actionError && (
        <p className="text-mafia text-xs text-center mb-3">{actionError}</p>
      )}

      {/* 🎙️ إدارة النقاش — دور الكلام + عدّاد لعرضه على شاشة التلفزيون */}
      <div
        className="rounded-xl p-4 mb-6"
        style={{ background: "#141B26", border: "1px solid #2A3342" }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-gold">🎙️ إدارة النقاش</span>
          <button
            onClick={() => setShowNamesPanel((v) => !v)}
            className="text-[11px] text-muted border border-border rounded-full px-3 py-1"
          >
            {showNamesPanel ? "إخفاء الأسماء" : "قائمة اللاعبين"}
          </button>
        </div>

        {showNamesPanel && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {players
              .filter((p) => p.is_alive)
              .map((p) => {
                const isAccused = room.accused_player_id === p.id;
                const idx = room.speaking_order.indexOf(p.id);
                const hasSpoken =
                  idx > -1 && idx <= room.speaking_index && room.speaking_turn_started_at !== null;
                return (
                  <button
                    key={p.id}
                    onClick={() => markAccused(p.id)}
                    className="text-[11px] px-3 py-1.5 rounded-full"
                    style={{
                      background: isAccused ? "#8B263533" : "#0B0E14",
                      color: isAccused ? "#C0392B" : hasSpoken ? "#4A5264" : "#EDEAE0",
                      border: `1px solid ${isAccused ? "#8B263566" : "#2A3342"}`,
                    }}
                    title="اضغط لجعله آخر واحد يتكلم (متهم)"
                  >
                    {p.name}
                  </button>
                );
              })}
          </div>
        )}

        {(() => {
          const started = room.speaking_index >= 0 && room.speaking_order.length > 0;
          const finished = started && room.speaking_index >= room.speaking_order.length;
          const currentId =
            started && !finished ? room.speaking_order[room.speaking_index] : null;
          const elapsed = room.speaking_turn_started_at
            ? (Date.now() - new Date(room.speaking_turn_started_at).getTime()) / 1000
            : 0;
          const remaining = Math.max(
            0,
            Math.ceil(room.speaking_duration_seconds - elapsed)
          );

          return (
            <>
              <div className="text-center mb-3">
                {!started && (
                  <p className="text-xs text-muted">لم يبدأ النقاش بعد</p>
                )}
                {started && !finished && (
                  <>
                    <p className="text-[10px] text-muted mb-1">المتكلم الحالي</p>
                    <p className="text-lg font-bold text-cream">
                      {playerName(currentId)}
                    </p>
                    <p dir="ltr" className="text-2xl font-display text-gold mt-1">
                      {Math.floor(remaining / 60)}:
                      {String(remaining % 60).padStart(2, "0")}
                    </p>
                    <p className="text-[10px] text-muted mt-1">
                      الدور {room.speaking_index + 1} / {room.speaking_order.length}
                    </p>
                  </>
                )}
                {finished && (
                  <p className="text-xs text-muted">انتهى دور الجميع بالكلام</p>
                )}
              </div>

              <div className="flex items-center justify-center gap-2 mb-2">
                <button
                  onClick={() => extendTime(30)}
                  disabled={!started || finished}
                  className="text-[11px] px-3 py-2 rounded-full border border-border text-muted disabled:opacity-30"
                >
                  +30 ثانية
                </button>
                <button
                  onClick={startDiscussion}
                  className="text-sm font-bold px-6 py-2.5 rounded-full"
                  style={{ background: "#C9A227", color: "#0B0E14" }}
                >
                  {started && !finished ? "إعادة البدء" : "ابدأ"}
                </button>
                <button
                  onClick={nextSpeaker}
                  disabled={!started || finished}
                  className="text-[11px] px-3 py-2 rounded-full border border-border text-muted disabled:opacity-30"
                >
                  التالي
                </button>
              </div>

              <button
                onClick={() =>
                  window.open(`/room/${code}/tv`, "_blank", "noopener")
                }
                className="w-full text-[11px] text-center text-gold mt-2"
              >
                📺 فتح شاشة العرض للتلفزيون
              </button>
            </>
          );
        })()}
      </div>

      <div className="flex flex-col gap-1.5">
        {players.map((p) => {
          const def = p.role ? ROLES[p.role] : null;
          return (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg px-3 py-2.5"
              style={{
                background: "#141B26",
                opacity: p.is_alive ? 1 : 0.45,
              }}
            >
              <span className="flex flex-col">
                <span className="text-sm text-cream">{p.name}</span>
                <span className="text-[10px] text-muted">
                  {def ? def.nameAr : "بدون دور"}
                </span>
              </span>
              <span
                className="text-[10px] px-2 py-1 rounded-full"
                style={{
                  background:
                    p.team === "mafia" ? "#8B263533" : "#2F6F6233",
                  color: p.team === "mafia" ? "#C0392B" : "#3FA37A",
                }}
              >
                {p.team === "mafia" ? "مافيا" : p.team === "civilian" ? "شعب" : "—"}
                {" · "}
                {p.is_alive ? "حي" : "ميت"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="text-[10px] tracking-[0.2em] text-muted mt-8 mb-2 text-center">
        ⚙️ أدوات الحكم
      </div>
      <div className="flex flex-col gap-1.5">
        {players.map((p) => (
          <div
            key={p.id + "-tool"}
            className="flex items-center justify-between rounded-lg px-3 py-2 bg-panel border border-border"
          >
            <span className="text-xs text-cream">{p.name}</span>
            <button
              onClick={() => toggleAlive(p)}
              className="text-[11px] px-3 py-1.5 rounded-full font-bold"
              style={{
                background: p.is_alive ? "#8B263522" : "#2F6F6222",
                color: p.is_alive ? "#C0392B" : "#3FA37A",
                border: `1px solid ${p.is_alive ? "#8B263566" : "#2F6F6266"}`,
              }}
            >
              {p.is_alive ? "إخراج من اللعبة" : "إعادة إحياء"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
