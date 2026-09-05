"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  ensureAnonymousSession,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";

interface RoomRow {
  id: string;
  speaking_order: string[];
  speaking_index: number;
  speaking_turn_started_at: string | null;
  speaking_duration_seconds: number;
  last_speaker_ids: string[];
}

interface PlayerRow {
  id: string;
  name: string;
}

export default function TvDisplayPage() {
  const params = useParams();
  const code = String(params.code || "").toUpperCase();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select(
          "id, speaking_order, speaking_index, speaking_turn_started_at, speaking_duration_seconds, last_speaker_ids"
        )
        .eq("code", code)
        .maybeSingle();

      if (roomError || !roomData) {
        setError("لم يتم العثور على الغرفة.");
        setLoading(false);
        return;
      }
      setRoom(roomData as RoomRow);

      const { data: playersData } = await supabase.rpc(
        "get_public_player_names",
        { p_room_id: roomData.id }
      );

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

  useEffect(() => {
    if (!room?.id) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`tv-${room.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        () => {
          setError("أغلق الحكم هذه الغرفة. انتهت اللعبة.");
          setRoom(null);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-2xl" style={{ background: "#FBF6EC", color: "#2B2117" }}>
        جارٍ التحميل...
      </main>
    );
  }

  if (error || !room) {
    return (
      <main className="min-h-screen flex items-center justify-center text-2xl" style={{ background: "#FBF6EC", color: "#C0392B" }}>
        {error}
      </main>
    );
  }

  const playerName = (id: string | null) =>
    id ? players.find((p) => p.id === id)?.name || "" : "";

  const started = room.speaking_index >= 0 && room.speaking_order.length > 0;
  const finished = started && room.speaking_index >= room.speaking_order.length;
  const currentId = started && !finished ? room.speaking_order[room.speaking_index] : null;
  const nextId =
    started && !finished && room.speaking_index + 1 < room.speaking_order.length
      ? room.speaking_order[room.speaking_index + 1]
      : null;

  const elapsed = room.speaking_turn_started_at
    ? (Date.now() - new Date(room.speaking_turn_started_at).getTime()) / 1000
    : 0;
  const remaining = Math.max(0, Math.ceil(room.speaking_duration_seconds - elapsed));
  const pct = started && !finished ? Math.max(0, Math.min(1, remaining / room.speaking_duration_seconds)) : 0;
  const isAccusedTurn = currentId && room.last_speaker_ids?.includes(currentId);

  return (
    <main
      dir="rtl"
      className="min-h-screen flex flex-col items-center px-6 py-8"
      style={{
        background: "radial-gradient(ellipse at top, #FFFFFF 0%, #FBF6EC 60%)",
        fontFamily: "'Tajawal', sans-serif",
      }}
    >
      {/* شعار علوي ثابت — يعطي طابع احترافي بغض النظر عن حالة الشاشة */}
      <div className="flex items-center gap-2 mb-8">
        <span
          className="text-lg tracking-[0.2em]"
          style={{ fontFamily: "'Rakkas', serif", color: "#C9A227" }}
        >
          مافيا الكويت
        </span>
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: "#3FA37A" }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full">
        {!started && (
          <div className="text-center">
            <div className="text-5xl mb-5 opacity-70">🎴</div>
            <div className="text-xl sm:text-2xl" style={{ color: "#8B7F68" }}>
              بانتظار بدء النقاش من الحكم
            </div>
          </div>
        )}

        {finished && (
          <div className="text-center">
            <div className="text-6xl mb-5">✅</div>
            <div className="text-2xl sm:text-3xl" style={{ color: "#2B2117" }}>
              انتهى دور الجميع بالكلام
            </div>
          </div>
        )}

        {started && !finished && (
          <div className="flex flex-col items-center gap-6 w-full max-w-md">
            <div
              className="flex items-center gap-2 px-4 py-1.5 rounded-full text-sm tracking-[0.25em]"
              style={{
                background: isAccusedTurn ? "#C0392B22" : "#EAF5F099",
                border: `1px solid ${isAccusedTurn ? "#C0392B66" : "#E6DFC8"}`,
                color: isAccusedTurn ? "#E05A4A" : "#8B7F68",
              }}
            >
              {isAccusedTurn ? "🔴 المتهم يتكلم" : "دور الكلام"}
            </div>

            <div
              className="text-5xl sm:text-6xl font-extrabold text-center leading-tight"
              style={{ color: "#2B2117", fontFamily: "'Rakkas', serif" }}
            >
              {playerName(currentId)}
            </div>

            <div
              className="text-7xl sm:text-8xl font-extrabold tabular-nums"
              dir="ltr"
              style={{
                color: remaining <= 10 ? "#E05A4A" : "#C9A227",
                transition: "color 0.3s",
              }}
            >
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
            </div>

            <div
              className="w-full h-2.5 rounded-full overflow-hidden"
              style={{ background: "#F0E9D6" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct * 100}%`,
                  background: remaining <= 10 ? "#E05A4A" : "#C9A227",
                  transition: "width 0.25s linear, background 0.3s",
                }}
              />
            </div>

            <div
              className="text-xs tracking-[0.15em]"
              style={{ color: "#B8AD95" }}
            >
              الدور {room.speaking_index + 1} من {room.speaking_order.length}
            </div>

            {nextId && (
              <div
                className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-full"
                style={{ background: "#FFFFFF", border: "1px solid #E6DFC8" }}
              >
                <span className="text-xs" style={{ color: "#B8AD95" }}>
                  التالي
                </span>
                <span className="text-base font-bold" style={{ color: "#2B2117" }}>
                  {playerName(nextId)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
