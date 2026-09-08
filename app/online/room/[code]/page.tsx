"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";

interface RoomRow {
  id: string;
  code: string;
  status: string;
  created_by_auth_id: string;
}

interface PlayerRow {
  id: string;
  name: string;
  is_ready: boolean;
  auth_id: string;
  is_spectator: boolean;
}

export default function OnlineWaitingRoomPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [myAuthId, setMyAuthId] = useState<string | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [managingPlayer, setManagingPlayer] = useState<PlayerRow | null>(null);
  const [actionError, setActionError] = useState("");

  const me = players.find((p) => p.auth_id === myAuthId) || null;
  const isCreator = room?.created_by_auth_id === myAuthId;
  const activePlayers = players.filter((p) => !p.is_spectator);
  const spectators = players.filter((p) => p.is_spectator);

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      setMyAuthId(session?.user.id ?? null);
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("online_rooms")
        .select("id, code, status, created_by_auth_id")
        .eq("code", code)
        .maybeSingle();
      if (roomError || !roomData) {
        setError("لم يتم العثور على الغرفة.");
        setLoading(false);
        return;
      }
      setRoom(roomData as RoomRow);

      if (roomData.status !== "waiting") {
        router.replace(`/online/room/${code}/play`);
        return;
      }

      const { data: playersData, error: playersError } = await supabase
        .from("online_players")
        .select("id, name, is_ready, auth_id, is_spectator")
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true });
      if (playersError) throw playersError;

      setPlayers((playersData as PlayerRow[]) || []);
      const mine = (playersData as PlayerRow[] | null)?.find(
        (p) => p.auth_id === session?.user.id
      );
      if (mine) setMyPlayerId(mine.id);
    } catch (e: any) {
      setError(e.message || "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }, [code, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`online-wait-${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "online_players", filter: `room_id=eq.${room.id}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "online_rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          const newStatus = (payload.new as any)?.status;
          if (newStatus && newStatus !== "waiting") {
            router.push(`/online/room/${code}/play`);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  // نبضة حياة بسيطة
  useEffect(() => {
    if (!myPlayerId) return;
    const supabase = getSupabaseBrowserClient();
    const ping = () =>
      supabase
        .from("online_players")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", myPlayerId)
        .then(() => {});
    ping();
    const interval = setInterval(ping, 20000);
    return () => clearInterval(interval);
  }, [myPlayerId]);

  async function callApi(path: string, payload: object) {
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "تعذّر تنفيذ العملية.");
    return json;
  }

  async function toggleReady() {
    setActionError("");
    try {
      await ensureAnonymousSession();
      await callApi("/api/online/rooms/ready", { roomCode: code });
    } catch (e: any) {
      setActionError(e.message);
    }
  }

  async function managePlayer(action: "kick" | "spectator") {
    if (!managingPlayer) return;
    setActionError("");
    try {
      await callApi("/api/online/rooms/manage-player", {
        roomCode: code,
        targetPlayerId: managingPlayer.id,
        action,
      });
      setManagingPlayer(null);
    } catch (e: any) {
      setActionError(e.message);
    }
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
          onClick={() => router.push("/online")}
          className="text-xs text-gold border border-gold rounded-full px-4 py-2"
        >
          رجوع
        </button>
      </main>
    );
  }

  const slots = Array.from({ length: 8 }, (_, i) => activePlayers[i] || null);

  return (
    <main className="min-h-screen px-5 py-8 max-w-md mx-auto flex flex-col">
      <div className="text-center mb-2">
        <p className="text-xs text-muted mb-1">رمز الغرفة</p>
        <p dir="ltr" className="font-display text-2xl text-gold tracking-widest">{code}</p>
        {isCreator && <p className="text-[10px] text-gold mt-1">👑 أنت منشئ الغرفة</p>}
      </div>

      <div dir="ltr" className="text-center text-3xl font-display text-gold my-4">
        {activePlayers.length}<span className="text-muted text-xl mx-1">/</span>8
      </div>

      {actionError && <p className="text-mafia text-xs text-center mb-3">{actionError}</p>}
      {isCreator && (
        <p className="text-[10px] text-muted text-center mb-3">
          اضغط على أي لاعب لطرده أو تحويله لمستمع
        </p>
      )}

      {managingPlayer && (
        <div
          className="rounded-xl p-4 mb-4 flex flex-col gap-2"
          style={{ background: "#141B26", border: "1px solid #C9A227" }}
        >
          <p className="text-xs text-center" style={{ color: "#EDEAE0" }}>
            ماذا تريد أن تفعل بـ "{managingPlayer.name}"؟
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => managePlayer("kick")}
              className="flex-1 rounded-lg py-2 text-xs font-bold"
              style={{ background: "#8B263533", color: "#E05A4A", border: "1px solid #8B2635" }}
            >
              طرد نهائي
            </button>
            <button
              onClick={() => managePlayer("spectator")}
              className="flex-1 rounded-lg py-2 text-xs font-bold"
              style={{ background: "#2A3342", color: "#8A93A6" }}
            >
              تحويل لمستمع
            </button>
          </div>
          <button
            onClick={() => setManagingPlayer(null)}
            className="text-[10px] text-center"
            style={{ color: "#5A6270" }}
          >
            إلغاء
          </button>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 mb-6">
        {slots.map((p, i) => (
          <div
            key={i}
            onClick={() => {
              if (isCreator && p && p.auth_id !== myAuthId) {
                setManagingPlayer(p);
              }
            }}
            className="aspect-square rounded-lg flex flex-col items-center justify-center gap-1"
            style={{
              background: p ? "#141B26" : "transparent",
              border: `1px solid ${p?.auth_id === myAuthId ? "#C9A227" : p ? "#2A3342" : "#1A2230"}`,
              cursor: isCreator && p && p.auth_id !== myAuthId ? "pointer" : "default",
            }}
          >
            {p ? (
              <>
                <span className="text-[10px] text-cream break-all text-center px-0.5">{p.name}</span>
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: p.is_ready ? "#3FA37A" : "#C0392B" }}
                />
              </>
            ) : (
              <span className="text-border text-lg">·</span>
            )}
          </div>
        ))}
      </div>

      {spectators.length > 0 && (
        <div className="mb-6">
          <p className="text-[10px] text-muted mb-2 text-center">مستمعون ({spectators.length})</p>
          <div className="flex flex-wrap gap-1.5 justify-center">
            {spectators.map((s) => (
              <span
                key={s.id}
                className="text-[10px] px-2 py-1 rounded-full"
                style={{ background: "#141B26", color: "#8A93A6", border: "1px solid #2A3342" }}
              >
                👁️ {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1" />

      {me && !me.is_spectator && (
        <button
          onClick={toggleReady}
          className="w-full rounded-xl py-3 text-sm font-bold"
          style={{
            background: me.is_ready ? "transparent" : "#C9A227",
            border: me.is_ready ? "1px solid #2A3342" : "none",
            color: me.is_ready ? "#8A93A6" : "#0B0E14",
          }}
        >
          {me.is_ready ? "إلغاء الاستعداد" : "مستعد"}
        </button>
      )}
      {me && me.is_spectator && (
        <p className="text-xs text-center" style={{ color: "#8A93A6" }}>
          أنت مستمع — بتقدر تتفرج وتدردش لما تبدأ اللعبة
        </p>
      )}
    </main>
  );
}
