"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ensureAnonymousSession,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";

interface RoomRow {
  id: string;
  code: string;
  status: string;
  target_player_count: number;
  host_auth_id: string;
}

interface PlayerRow {
  id: string;
  name: string;
  is_host: boolean;
  is_ready: boolean;
  is_alive: boolean;
  auth_id: string;
}

export default function LobbyPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [myAuthId, setMyAuthId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);

  const me = players.find((p) => p.auth_id === myAuthId) || null;
  const isHost = !!me?.is_host;
  const allReady = players.length > 0 && players.every((p) => p.is_ready);
  const isFull = room ? players.length >= room.target_player_count : false;
  const canStart = allReady && isFull;

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      setMyAuthId(session?.user.id ?? null);

      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, code, status, target_player_count, host_auth_id")
        .eq("code", code)
        .maybeSingle();

      if (roomError || !roomData) {
        setError("لم يتم العثور على الغرفة. ربما تم إغلاقها.");
        setLoading(false);
        return;
      }
      setRoom(roomData as RoomRow);

      const { data: playersData, error: playersError } = await supabase
        .from("players")
        .select("id, name, is_host, is_ready, is_alive, auth_id")
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true });

      if (playersError) {
        setError("تعذّر تحميل اللاعبين: " + playersError.message);
        setLoading(false);
        return;
      }

      setPlayers((playersData as PlayerRow[]) || []);
    } catch (e: any) {
      setError(e.message || "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: لاعبين + حالة الغرفة (بما فيها الحذف)
  useEffect(() => {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`room-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${room.id}`,
        },
        () => load()
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        () => {
          setError("تم إغلاق هذه الغرفة من قبل الحكم.");
          setRoom(null);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  async function toggleReady() {
    if (!me) return;
    const supabase = getSupabaseBrowserClient();
    await supabase
      .from("players")
      .update({ is_ready: !me.is_ready })
      .eq("id", me.id);
  }

  async function closeRoom() {
    if (!room || !isHost) return;
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
      setError("تعذّر إغلاق الغرفة: " + delError.message);
      setClosing(false);
      return;
    }
    router.push("/");
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

  const total = room.target_player_count;
  const slots = Array.from({ length: total }, (_, i) => players[i] || null);

  return (
    <main className="min-h-screen px-5 py-8 max-w-md mx-auto flex flex-col">
      {/* العدّاد بالنص فوق — dir=ltr لتفادي مشكلة انعكاس الأرقام بالـ RTL */}
      <div className="text-center mb-6">
        <div className="text-[10px] tracking-[0.3em] text-muted mb-1">
          عدد اللاعبين
        </div>
        <div
          dir="ltr"
          className="font-display text-4xl text-gold inline-block"
        >
          {players.length}
          <span className="text-muted text-2xl mx-1">/</span>
          {total}
        </div>
        {isHost && (
          <div className="text-[11px] text-gold mt-1">👑 أنت الحكم</div>
        )}
      </div>

      {/* شبكة المربعات */}
      <div className="grid grid-cols-4 gap-2 mb-8">
        {slots.map((p, i) => {
          const filled = !!p;
          const isMe = p?.auth_id === myAuthId;
          return (
            <div
              key={i}
              className="aspect-square rounded-lg flex items-center justify-center text-center px-1"
              style={{
                background: filled ? "#141B26" : "transparent",
                border: `1px solid ${
                  isMe ? "#C9A227" : filled ? "#2A3342" : "#1A2230"
                }`,
              }}
            >
              {filled ? (
                <div className="flex flex-col items-center gap-1">
                  <span
                    className="text-[10px] leading-tight break-all"
                    style={{ color: isMe ? "#C9A227" : "#EDEAE0" }}
                  >
                    {p!.name}
                  </span>
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: p!.is_ready ? "#3FA37A" : "#8A93A6",
                    }}
                  />
                </div>
              ) : (
                <span className="text-border text-lg">·</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex-1" />

      {!isHost && me && (
        <button
          onClick={toggleReady}
          className="w-full rounded-xl py-3 text-sm font-bold mb-3"
          style={{
            background: me.is_ready ? "transparent" : "#C9A227",
            border: me.is_ready ? "1px solid #2A3342" : "none",
            color: me.is_ready ? "#8A93A6" : "#0B0E14",
          }}
        >
          {me.is_ready ? "إلغاء الاستعداد" : "مستعد"}
        </button>
      )}

      {isHost && (
        <>
          <button
            disabled={!canStart}
            className="w-full rounded-xl py-3 text-sm font-bold mb-3 disabled:opacity-40"
            style={{ background: "#8B2635", color: "#EDEAE0" }}
          >
            {!isFull
              ? `بانتظار اكتمال اللاعبين (${players.length}/${total})`
              : !allReady
              ? "بانتظار استعداد الجميع"
              : "بدء اللعبة"}
          </button>

          <button
            onClick={closeRoom}
            disabled={closing}
            className="w-full rounded-xl py-3 text-xs font-bold disabled:opacity-40"
            style={{
              background: "transparent",
              border: "1px solid #8B2635",
              color: "#8B2635",
            }}
          >
            {closing ? "جارٍ الإغلاق..." : "إغلاق الغرفة وحذفها"}
          </button>
        </>
      )}
    </main>
  );
}
