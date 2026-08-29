"use client";

import { useEffect, useState, useCallback } from "react";
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
    </main>
  );
}
