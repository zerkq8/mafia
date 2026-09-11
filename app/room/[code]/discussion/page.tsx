"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ensureAnonymousSession,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";
import LocalDiscussionScreen from "@/components/LocalDiscussionScreen";

interface RoomRow {
  id: string;
  round_number: number;
  host_auth_id: string;
  discussion_phase: string;
  discussion_order: string[];
  discussion_index: number;
  discussion_turn_started_at: string | null;
  discussion_paused_at: string | null;
  discussion_total_paused_seconds: number;
  discussion_selected_players: string[];
}

interface PlayerRow {
  id: string;
  name: string;
}

export default function DiscussionPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select(
          "id, round_number, host_auth_id, discussion_phase, discussion_order, discussion_index, discussion_turn_started_at, discussion_paused_at, discussion_total_paused_seconds, discussion_selected_players"
        )
        .eq("code", code)
        .maybeSingle();

      if (roomError || !roomData) {
        setError("لم يتم العثور على الغرفة.");
        setLoading(false);
        return;
      }

      if (roomData.host_auth_id !== session?.user.id) {
        setError("هذه الصفحة مخصصة للحكم فقط.");
        setLoading(false);
        return;
      }
      setRoom(roomData as RoomRow);

      const { data: playersData, error: playersError } = await supabase
        .from("players")
        .select("id, name")
        .eq("room_id", roomData.id)
        .eq("is_host", false)
        .eq("is_alive", true);
      if (playersError) throw playersError;
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
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`discussion-${room.id}`)
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

  function togglePick(id: string) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  }

  async function startDiscussion() {
    if (!room || picked.length > 2) return;
    setStarting(true);
    setActionError("");
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch("/api/rooms/discussion/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomCode: code, selectedPlayerIds: picked }),
    });
    const json = await res.json();
    if (!res.ok) setActionError(json.error || "تعذّر بدء النقاش.");
    setStarting(false);
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
          onClick={() => router.push(`/room/${code}/gm`)}
          className="text-xs rounded-full px-4 py-2 border"
          style={{ color: "#C9A227", borderColor: "#C9A227" }}
        >
          رجوع للوحة الحكم
        </button>
      </main>
    );
  }

  if (room.discussion_phase !== "idle") {
    return (
      <LocalDiscussionScreen
        roomId={room.id}
        roomCode={code}
        roundNumber={room.round_number}
        phase={room.discussion_phase as "a" | "b" | "c"}
        order={room.discussion_order || []}
        index={room.discussion_index}
        turnStartedAt={room.discussion_turn_started_at}
        pausedAt={room.discussion_paused_at}
        totalPausedSeconds={room.discussion_total_paused_seconds}
        players={players}
        myPlayerId={null}
        isHost={true}
      />
    );
  }

  return (
    <main className="min-h-screen px-5 py-4 max-w-md mx-auto flex flex-col" style={{ background: "#0B0E14" }}>
      <div className="text-center mb-4">
        <div className="text-[11px] tracking-[0.3em] mb-1" style={{ color: "#8A93A6" }}>
          🎙️ إدارة النقاش
        </div>
        <div className="font-display text-2xl" style={{ color: "#C9A227" }}>اختر آخر متحدّثين</div>
      </div>

      <button
        onClick={() => router.push(`/room/${code}/gm`)}
        className="w-full text-xs text-center py-2 mb-4"
        style={{ color: "#8A93A6" }}
      >
        ← رجوع للوحة الحكم
      </button>

      {actionError && (
        <p className="text-xs text-center mb-3" style={{ color: "#E05A4A" }}>{actionError}</p>
      )}

      <p className="text-xs text-center mb-4" style={{ color: "#8A93A6" }}>
        اختر حتى شخصين ليكونوا آخر من يتكلم (اختياري — تقدر تختار صفر أو واحد أو اثنين). غير الشرطيّين — هذولي تلقائيين.
      </p>

      <div
        className="rounded-2xl p-4 mb-6"
        style={{ background: "#0F141C", border: "1px solid #1E2733" }}
      >
        <div className="flex flex-wrap gap-2 justify-center">
          {players.map((p) => {
            const isPicked = picked.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => togglePick(p.id)}
                className="text-sm px-4 py-2 rounded-full"
                style={{
                  background: isPicked ? "#C9A22733" : "#141B26",
                  border: `1px solid ${isPicked ? "#C9A227" : "#2A3342"}`,
                  color: isPicked ? "#F5E7BE" : "#EDEAE0",
                }}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1" />

      <button
        onClick={startDiscussion}
        disabled={starting}
        className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-40"
        style={{ background: "#C9A227", color: "#0B0E14" }}
      >
        {starting ? "جارٍ البدء..." : "ابدأ النقاش"}
      </button>
    </main>
  );
}
