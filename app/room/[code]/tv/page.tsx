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
  accused_player_id: string | null;
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
          "id, speaking_order, speaking_index, speaking_turn_started_at, speaking_duration_seconds, accused_player_id"
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white text-2xl">
        جارٍ التحميل...
      </main>
    );
  }

  if (error || !room) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-red-500 text-2xl">
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
  const isAccusedTurn = currentId && currentId === room.accused_player_id;

  return (
    <main
      dir="rtl"
      className="min-h-screen flex flex-col items-center justify-center px-10"
      style={{
        background: "#05070A",
        fontFamily: "'Tajawal', sans-serif",
      }}
    >
      {!started && (
        <div className="text-center">
          <div className="text-5xl mb-4" style={{ color: "#8A93A6" }}>
            🎴
          </div>
          <div className="text-3xl" style={{ color: "#8A93A6" }}>
            بانتظار بدء النقاش من الحكم
          </div>
        </div>
      )}

      {finished && (
        <div className="text-center">
          <div className="text-6xl mb-4">✅</div>
          <div className="text-4xl" style={{ color: "#EDEAE0" }}>
            انتهى دور الجميع بالكلام
          </div>
        </div>
      )}

      {started && !finished && (
        <div className="flex flex-col items-center gap-8 w-full max-w-3xl">
          <div
            className="text-2xl tracking-[0.4em]"
            style={{ color: isAccusedTurn ? "#C0392B" : "#8A93A6" }}
          >
            {isAccusedTurn ? "المتهم يتكلم" : "دور الكلام"}
          </div>

          <div
            className="text-8xl font-extrabold text-center"
            style={{ color: "#EDEAE0", fontFamily: "'Rakkas', serif" }}
          >
            {playerName(currentId)}
          </div>

          <div
            className="text-9xl font-extrabold tabular-nums"
            dir="ltr"
            style={{
              color: remaining <= 10 ? "#C0392B" : "#C9A227",
              transition: "color 0.3s",
            }}
          >
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
          </div>

          <div
            className="w-full h-3 rounded-full overflow-hidden"
            style={{ background: "#141B26" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct * 100}%`,
                background: remaining <= 10 ? "#C0392B" : "#C9A227",
                transition: "width 0.25s linear, background 0.3s",
              }}
            />
          </div>

          {nextId && (
            <div className="text-lg" style={{ color: "#8A93A6" }}>
              التالي: <span style={{ color: "#EDEAE0" }}>{playerName(nextId)}</span>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
