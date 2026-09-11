"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ensureAnonymousSession,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";
import { ROLES, RoleKey, TeamKey } from "@/lib/roles";
import LocalVotingScreen from "@/components/LocalVotingScreen";
import LocalSniperRevengeScreen from "@/components/LocalSniperRevengeScreen";
import LocalGameOverScreen from "@/components/LocalGameOverScreen";

interface RoomRow {
  id: string;
  code: string;
  status: string;
  round_number: number;
  host_auth_id: string;
  voting_phase: string;
  voting_order: string[];
  voting_index: number;
  voting_turn_started_at: string | null;
  voting_result_started_at: string | null;
  voting_eliminated_player_id: string | null;
  voting_tie: boolean;
  sniper_revenge_phase: string;
  sniper_revenge_sniper_id: string | null;
  sniper_revenge_started_at: string | null;
  sniper_revenge_victim_id: string | null;
  sniper_revenge_result_started_at: string | null;
  winner: string | null;
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
  const [closing, setClosing] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  // مخفي دايمًا افتراضيًا عند فتح الصفحة — حالة واجهة محلية بس، بدون تخزين أو مزامنة، للسلامة لو الشاشة معروضة على تلفاز مشترك
  const [playersVisible, setPlayersVisible] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select(
          "id, code, status, round_number, host_auth_id, voting_phase, voting_order, voting_index, voting_turn_started_at, voting_result_started_at, voting_eliminated_player_id, voting_tie, sniper_revenge_phase, sniper_revenge_sniper_id, sniper_revenge_started_at, sniper_revenge_victim_id, sniper_revenge_result_started_at, winner"
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
        (payload) => {
          setRoom((prev) => (prev ? { ...prev, ...(payload.new as any) } : prev));
        }
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

    if (willKill) {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const triggerRes = await fetch("/api/rooms/sniper/trigger", {
        method: "POST",
        headers,
        body: JSON.stringify({ roomCode: code, killedPlayerId: player.id }),
      })
        .then((r) => r.json())
        .catch(() => null);

      // لو ما كان قناصًا (أو تعذّر التشغيل)، افحص شروط الفوز فورًا —
      // لو كان قناصًا، دور الانتقام نفسه يفحص الفوز بعد ما يخلص بالكامل
      if (!triggerRes?.triggered) {
        await fetch("/api/rooms/check-win", {
          method: "POST",
          headers,
          body: JSON.stringify({ roomCode: code }),
        }).catch(() => {});
      }
    }
  }

  async function startVoting() {
    if (!room) return;
    const aliveCount = players.filter((p) => p.is_alive).length;
    if (aliveCount < 2) {
      setActionError("يحتاج التصويت لاعبين اثنين أحياء على الأقل.");
      return;
    }
    const ok = window.confirm("هل تريد بدء جولة تصويت الآن؟");
    if (!ok) return;

    setActionError("");
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch("/api/rooms/voting/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomCode: code }),
    });
    const json = await res.json();
    if (!res.ok) setActionError(json.error || "تعذّر بدء التصويت.");
  }

  async function closeRoom() {
    if (!room) return;
    const ok = window.confirm(
      "هل أنت متأكد من إغلاق الغرفة؟ سيتم حذف كل بيانات هذه الجولة نهائيًا لجميع اللاعبين."
    );
    if (!ok) return;

    setClosing(true);
    const supabase = getSupabaseBrowserClient();
    const { error: delError } = await supabase
      .from("rooms")
      .delete()
      .eq("id", room.id);

    if (delError) {
      setActionError("تعذّر إغلاق الغرفة: " + delError.message);
      setClosing(false);
      return;
    }
    router.push("/");
  }

  if (loading) {
    return (
      <main
        className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: "#0B0E14", color: "#8A93A6" }}
      >
        جارٍ التحميل...
      </main>
    );
  }

  if (error || !room) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-4"
        style={{ background: "#0B0E14" }}
      >
        <p className="text-sm text-center" style={{ color: "#E05A4A" }}>{error}</p>
        <button
          onClick={() => router.push("/")}
          className="text-xs rounded-full px-4 py-2 border"
          style={{ color: "#C9A227", borderColor: "#C9A227" }}
        >
          رجوع للرئيسية
        </button>
      </main>
    );
  }

  const aliveCount = players.filter((p) => p.is_alive).length;

  if (room.sniper_revenge_phase === "choosing" || room.sniper_revenge_phase === "result") {
    return (
      <LocalSniperRevengeScreen
        roomCode={code}
        phase={room.sniper_revenge_phase as "choosing" | "result"}
        sniperId={room.sniper_revenge_sniper_id}
        startedAt={room.sniper_revenge_started_at}
        victimId={room.sniper_revenge_victim_id}
        resultStartedAt={room.sniper_revenge_result_started_at}
        players={players.map((p) => ({ id: p.id, name: p.name, is_alive: p.is_alive }))}
        myPlayerId={null}
      />
    );
  }

  if (room.winner === "mafia" || room.winner === "civilians") {
    return <LocalGameOverScreen winner={room.winner as "mafia" | "civilians"} />;
  }

  if (room.voting_phase === "voting" || room.voting_phase === "result") {
    return (
      <LocalVotingScreen
        roomId={room.id}
        roomCode={code}
        roundNumber={room.round_number}
        votingPhase={room.voting_phase as "voting" | "result"}
        votingOrder={room.voting_order || []}
        votingIndex={room.voting_index}
        votingTurnStartedAt={room.voting_turn_started_at}
        votingResultStartedAt={room.voting_result_started_at}
        eliminatedPlayerId={room.voting_eliminated_player_id}
        tie={room.voting_tie}
        players={players.map((p) => ({ id: p.id, name: p.name }))}
        myPlayerId={null}
      />
    );
  }

  return (
    <main className="min-h-screen px-5 py-4 max-w-md mx-auto" style={{ background: "#0B0E14" }}>
      <div className="text-center mb-6">
        <div className="text-[11px] tracking-[0.3em] mb-1" style={{ color: "#8A93A6" }}>
          👑 لوحة الحكم
        </div>
        <div className="font-display text-2xl mb-2" style={{ color: "#C9A227" }}>
          الجولة {room.round_number}
        </div>
        <div
          dir="ltr"
          className="inline-flex text-xs px-3 py-1 rounded-full"
          style={{ background: "#141B26", border: "1px solid #2A3342", color: "#8A93A6" }}
        >
          الأحياء: {aliveCount}/{players.length}
        </div>
      </div>

      {actionError && (
        <p className="text-xs text-center mb-3" style={{ color: "#E05A4A" }}>{actionError}</p>
      )}

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => router.push(`/room/${code}/discussion`)}
          className="flex-1 rounded-xl py-3 text-sm font-bold"
          style={{ background: "#141B26", border: "1px solid #C9A227", color: "#C9A227" }}
        >
          🎙️ إدارة النقاش
        </button>
        <button
          onClick={startVoting}
          className="flex-1 rounded-xl py-3 text-sm font-bold"
          style={{ background: "#141B26", border: "1px solid #E05A4A", color: "#E05A4A" }}
        >
          🗳️ تصويت
        </button>
      </div>

      <button
        onClick={() => setPlayersVisible((v) => !v)}
        className="w-full rounded-xl py-2.5 text-xs font-bold mb-3"
        style={{ background: "#141B26", border: "1px solid #2A3342", color: "#8A93A6" }}
      >
        {playersVisible ? "🙈 إخفاء اللاعبين" : "👁️ إظهار اللاعبين"}
      </button>

      {!playersVisible ? (
        <div
          className="rounded-xl py-6 text-center text-xs mb-1.5"
          style={{ background: "#141B26", border: "1px solid #2A3342", color: "#5A6270" }}
        >
          اللاعبون مخفيون — اضغط 👁️ لإظهارهم
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {players.map((p) => {
            const def = p.role ? ROLES[p.role] : null;
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                style={{
                  background: "#141B26",
                  border: "1px solid #2A3342",
                  opacity: p.is_alive ? 1 : 0.45,
                }}
              >
                {p.role ? (
                  <img
                    src={`/roles/color-sm/${p.role}.png`}
                    alt={def?.nameAr || ""}
                    width={30}
                    height={30}
                    style={{ objectFit: "contain" }}
                  />
                ) : (
                  <div
                    className="rounded-full"
                    style={{ width: 30, height: 30, background: "#2A3342" }}
                  />
                )}
                <span className="flex flex-col flex-1">
                  <span className="text-sm" style={{ color: "#EDEAE0" }}>{p.name}</span>
                  <span className="text-[11px]" style={{ color: "#8A93A6" }}>
                    {def ? def.nameAr : "بدون دور"}
                  </span>
                </span>
                <span
                  className="text-[11px] px-2 py-1 rounded-full"
                  style={{
                    background:
                      p.team === "mafia" ? "#E05A4A33" : "#3FA37A33",
                    color: p.team === "mafia" ? "#E05A4A" : "#3FA37A",
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
      )}

      <div className="text-[11px] tracking-[0.2em] mt-8 mb-2 text-center" style={{ color: "#8A93A6" }}>
        ⚙️ أدوات الحكم
      </div>
      <div className="flex flex-col gap-1.5">
        {players.map((p) => (
          <div
            key={p.id + "-tool"}
            className="flex items-center justify-between rounded-lg px-3 py-2"
            style={{ background: "#141B26", border: "1px solid #2A3342" }}
          >
            <span className="text-xs" style={{ color: "#EDEAE0" }}>{p.name}</span>
            <button
              onClick={() => toggleAlive(p)}
              className="text-[11px] px-3 py-1.5 rounded-full font-bold"
              style={{
                background: p.is_alive ? "#E05A4A22" : "#3FA37A22",
                color: p.is_alive ? "#E05A4A" : "#3FA37A",
                border: `1px solid ${p.is_alive ? "#E05A4A66" : "#3FA37A66"}`,
              }}
            >
              {p.is_alive ? "إخراج من اللعبة" : "إعادة إحياء"}
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={closeRoom}
        disabled={closing}
        className="w-full rounded-xl py-3 text-xs font-bold mt-8 disabled:opacity-40"
        style={{
          background: "transparent",
          border: "1px solid #E05A4A",
          color: "#E05A4A",
        }}
      >
        {closing ? "جارٍ الإغلاق..." : "إغلاق الغرفة وحذفها"}
      </button>
    </main>
  );
}
