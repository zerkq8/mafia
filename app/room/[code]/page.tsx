"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import QRCode from "qrcode";
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
  const code = String(params.code || "").toUpperCase();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [myAuthId, setMyAuthId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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
        setError("لم يتم العثور على الغرفة.");
        setLoading(false);
        return;
      }
      setRoom(roomData as RoomRow);

      const { data: playersData } = await supabase
        .from("players")
        .select("id, name, is_host, is_ready, is_alive, auth_id")
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true });

      setPlayers((playersData as PlayerRow[]) || []);

      const url = `${window.location.origin}/room/${code}`;
      const qr = await QRCode.toDataURL(url, {
        margin: 1,
        color: { dark: "#0B0E14", light: "#EDEAE0" },
      });
      setQrDataUrl(qr);
    } catch (e: any) {
      setError(e.message || "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime subscription على جدول اللاعبين لهذه الغرفة
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
        () => {
          load();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        () => {
          load();
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

  function copyCode() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-muted text-sm">
        جارٍ التحميل...
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-mafia text-sm text-center">{error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-5 py-8 max-w-md mx-auto flex flex-col">
      <div className="text-center mb-6">
        <div className="text-[10px] tracking-[0.3em] text-muted mb-1">
          رمز الغرفة
        </div>
        <div className="flex items-center justify-center gap-2">
          <span className="font-display text-3xl text-gold tracking-widest">
            {code}
          </span>
          <button
            onClick={copyCode}
            className="text-xs text-muted border border-border rounded-full px-3 py-1"
          >
            {copied ? "تم النسخ ✓" : "نسخ"}
          </button>
        </div>
      </div>

      {qrDataUrl && (
        <div className="flex justify-center mb-6">
          <img
            src={qrDataUrl}
            alt="QR"
            className="w-32 h-32 rounded-lg border border-border"
          />
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-muted">
          {players.length} / {room?.target_player_count} لاعبًا
        </span>
        {isHost && (
          <span className="text-xs text-gold">👑 أنت الحكم</span>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-2 mb-6">
        {players.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg px-4 py-3 bg-panel border border-border"
          >
            <span className="text-sm flex items-center gap-2">
              {p.name}
              {p.is_host && <span className="text-[10px] text-gold">👑</span>}
              {p.auth_id === myAuthId && (
                <span className="text-[10px] text-muted">(أنت)</span>
              )}
            </span>
            <span
              className="text-xs flex items-center gap-1"
              style={{ color: p.is_ready ? "#3FA37A" : "#8A93A6" }}
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ background: p.is_ready ? "#3FA37A" : "#8A93A6" }}
              />
              {p.is_ready ? "مستعد" : "غير مستعد"}
            </span>
          </div>
        ))}
      </div>

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
        <button
          disabled={!canStart}
          className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-40"
          style={{ background: "#8B2635", color: "#EDEAE0" }}
        >
          {!isFull
            ? `بانتظار اكتمال اللاعبين (${players.length}/${room?.target_player_count})`
            : !allReady
            ? "بانتظار استعداد الجميع"
            : "بدء اللعبة"}
        </button>
      )}
    </main>
  );
}
