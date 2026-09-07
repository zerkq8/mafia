"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";

interface RoomRow {
  id: string;
  code: string;
  status: string;
}

interface PlayerRow {
  id: string;
  name: string;
  is_ready: boolean;
  auth_id: string;
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
  const [actionError, setActionError] = useState("");

  const me = players.find((p) => p.auth_id === myAuthId) || null;

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      setMyAuthId(session?.user.id ?? null);
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("online_rooms")
        .select("id, code, status")
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
        .select("id, name, is_ready, auth_id")
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

  async function toggleReady() {
    setActionError("");
    try {
      await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/online/rooms/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode: code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "تعذّر تنفيذ العملية.");
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

  const slots = Array.from({ length: 8 }, (_, i) => players[i] || null);

  return (
    <main className="min-h-screen px-5 py-8 max-w-md mx-auto flex flex-col">
      <div className="text-center mb-2">
        <p className="text-xs text-muted mb-1">رمز الغرفة</p>
        <p dir="ltr" className="font-display text-2xl text-gold tracking-widest">{code}</p>
      </div>

      <div dir="ltr" className="text-center text-3xl font-display text-gold my-4">
        {players.length}<span className="text-muted text-xl mx-1">/</span>8
      </div>

      {actionError && <p className="text-mafia text-xs text-center mb-3">{actionError}</p>}

      <div className="grid grid-cols-4 gap-2 mb-8">
        {slots.map((p, i) => (
          <div
            key={i}
            className="aspect-square rounded-lg flex flex-col items-center justify-center gap-1"
            style={{
              background: p ? "#141B26" : "transparent",
              border: `1px solid ${p?.auth_id === myAuthId ? "#C9A227" : p ? "#2A3342" : "#1A2230"}`,
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

      <div className="flex-1" />

      {me && (
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
    </main>
  );
}
