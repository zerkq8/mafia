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

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, code, status, round_number, host_auth_id")
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
