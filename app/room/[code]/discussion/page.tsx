"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ensureAnonymousSession,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";
import { RoleKey, TeamKey } from "@/lib/roles";
import RoleIcon from "@/components/icons/RoleIcon";

const START_DURATION_SECONDS = 35;

interface RoomRow {
  id: string;
  round_number: number;
  host_auth_id: string;
  speaking_order: string[];
  speaking_index: number;
  speaking_turn_started_at: string | null;
  speaking_duration_seconds: number;
  last_speaker_ids: string[];
}

interface PlayerRow {
  id: string;
  name: string;
  is_alive: boolean;
  role: RoleKey | null;
  team: TeamKey | null;
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
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select(
          "id, round_number, host_auth_id, speaking_order, speaking_index, speaking_turn_started_at, speaking_duration_seconds, last_speaker_ids"
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
        .select("id, name, is_alive, is_host")
        .eq("room_id", roomData.id)
        .eq("is_host", false);
      if (playersError) throw playersError;

      const { data: assignments } = await supabase
        .from("role_assignments")
        .select("player_id, role, team")
        .eq("room_id", roomData.id)
        .eq("round_number", roomData.round_number);

      const roleMap = new Map((assignments || []).map((a) => [a.player_id, a]));

      setPlayers(
        (playersData || []).map((p) => {
          const a = roleMap.get(p.id);
          return {
            id: p.id,
            name: p.name,
            is_alive: p.is_alive,
            role: (a?.role as RoleKey) || null,
            team: (a?.team as TeamKey) || null,
          };
        })
      );
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
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  function shuffleIds(ids: string[]) {
    const arr = [...ids];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async function startDiscussion() {
    if (!room) return;
    const eligible = players
      .filter((p) => p.is_alive && p.role !== "detective" && p.role !== "mafia_cop")
      .map((p) => p.id);

    if (eligible.length === 0) {
      setActionError("لا يوجد لاعبون مؤهلون لبدء النقاش.");
      return;
    }

    const order = shuffleIds(eligible);
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from("rooms")
      .update({
        speaking_order: order,
        speaking_index: 0,
        speaking_turn_started_at: new Date().toISOString(),
        speaking_duration_seconds: START_DURATION_SECONDS,
        last_speaker_ids: [],
      })
      .eq("id", room.id);
    if (updateError) setActionError("تعذّر بدء النقاش: " + updateError.message);
    else setActionError("");
  }

  async function stopDiscussion() {
    if (!room) return;
    const ok = window.confirm("هل تريد إيقاف النقاش الحالي؟");
    if (!ok) return;
    const supabase = getSupabaseBrowserClient();
    await supabase
      .from("rooms")
      .update({
        speaking_order: [],
        speaking_index: -1,
        speaking_turn_started_at: null,
        last_speaker_ids: [],
      })
      .eq("id", room.id);
  }

  async function nextSpeaker() {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    const nextIndex = room.speaking_index + 1;
    await supabase
      .from("rooms")
      .update({
        speaking_index: nextIndex,
        speaking_turn_started_at:
          nextIndex < room.speaking_order.length ? new Date().toISOString() : null,
      })
      .eq("id", room.id);
  }

  async function extendTime(deltaSeconds: number) {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    await supabase
      .from("rooms")
      .update({
        speaking_duration_seconds: Math.max(10, room.speaking_duration_seconds + deltaSeconds),
      })
      .eq("id", room.id);
  }

  // تحديد لاعب كـ"آخر متكلم" — يدعم اثنين كحد أقصى (FIFO)
  async function toggleLastSpeaker(playerId: string) {
    if (!room) return;
    let ids = [...(room.last_speaker_ids || [])];

    if (ids.includes(playerId)) {
      ids = ids.filter((id) => id !== playerId);
    } else {
      if (ids.length >= 2) ids.shift(); // نشيل الأقدم لو وصلنا الحد الأقصى
      ids.push(playerId);
    }

    // أعد ترتيب الدور: انقل من لسا ما تكلم من هالقائمة لآخر الطابور، بنفس ترتيب الاختيار
    const order = [...(room.speaking_order || [])];
    ids.forEach((id) => {
      const idx = order.indexOf(id);
      if (idx > -1 && idx > room.speaking_index) {
        order.splice(idx, 1);
        order.push(id);
      }
    });

    const supabase = getSupabaseBrowserClient();
    await supabase
      .from("rooms")
      .update({ speaking_order: order, last_speaker_ids: ids })
      .eq("id", room.id);
  }

  function playerName(id: string | null) {
    if (!id) return "";
    return players.find((p) => p.id === id)?.name || "";
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
          onClick={() => router.push(`/room/${code}/gm`)}
          className="text-xs text-gold border border-gold rounded-full px-4 py-2"
        >
          رجوع للوحة الحكم
        </button>
      </main>
    );
  }

  const nameList = players.filter(
    (p) => p.is_alive && p.role !== "detective" && p.role !== "mafia_cop"
  );

  const started = room.speaking_index >= 0 && room.speaking_order.length > 0;
  const finished = started && room.speaking_index >= room.speaking_order.length;
  const running = started && !finished;
  const currentId = running ? room.speaking_order[room.speaking_index] : null;
  const elapsed = room.speaking_turn_started_at
    ? (Date.now() - new Date(room.speaking_turn_started_at).getTime()) / 1000
    : 0;
  const remaining = Math.max(0, Math.ceil(room.speaking_duration_seconds - elapsed));

  return (
    <main className="min-h-screen px-5 py-8 max-w-md mx-auto flex flex-col">
      <div className="text-center mb-4">
        <div className="text-[10px] tracking-[0.3em] text-muted mb-1">
          🎙️ إدارة النقاش
        </div>
        <div className="font-display text-2xl text-gold">دور الكلام</div>
      </div>

      <button
        onClick={() => router.push(`/room/${code}/gm`)}
        className="w-full text-xs text-center py-2 mb-4"
        style={{ color: "#8A93A6" }}
      >
        ← رجوع للوحة الحكم
      </button>

      {actionError && (
        <p className="text-mafia text-xs text-center mb-3">{actionError}</p>
      )}

      {/* بطاقة الحالة الحالية */}
      <div
        className="rounded-2xl p-6 mb-5 text-center"
        style={{ background: "#141B26", border: "1px solid #2A3342" }}
      >
        {!started && (
          <p className="text-sm py-4" style={{ color: "#8A93A6" }}>
            لم يبدأ النقاش بعد
          </p>
        )}
        {running && (
          <>
            <p className="text-[10px] tracking-[0.2em] mb-2" style={{ color: "#8A93A6" }}>
              المتكلم الحالي
            </p>
            <p className="text-2xl font-bold mb-3" style={{ color: "#EDEAE0" }}>
              {playerName(currentId)}
            </p>
            <p
              dir="ltr"
              className="text-5xl font-display mb-2"
              style={{ color: remaining <= 10 ? "#E05A4A" : "#C9A227" }}
            >
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
            </p>
            <p className="text-[11px]" style={{ color: "#5A6270" }}>
              الدور {room.speaking_index + 1} من {room.speaking_order.length}
            </p>
          </>
        )}
        {finished && (
          <p className="text-sm py-4" style={{ color: "#8A93A6" }}>
            ✅ انتهى دور الجميع بالكلام
          </p>
        )}
      </div>

      {/* أزرار التحكم */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <button
          onClick={() => extendTime(30)}
          disabled={!running}
          className="text-xs px-4 py-3 rounded-full border border-border text-muted disabled:opacity-30"
        >
          +30 ثانية
        </button>
        {running ? (
          <button
            onClick={stopDiscussion}
            className="text-sm font-bold px-8 py-3 rounded-full"
            style={{ background: "#8B2635", color: "#EDEAE0" }}
          >
            إيقاف
          </button>
        ) : (
          <button
            onClick={startDiscussion}
            className="text-sm font-bold px-8 py-3 rounded-full"
            style={{ background: "#C9A227", color: "#0B0E14" }}
          >
            ابدأ
          </button>
        )}
        <button
          onClick={nextSpeaker}
          disabled={!running}
          className="text-xs px-4 py-3 rounded-full border border-border text-muted disabled:opacity-30"
        >
          التالي
        </button>
      </div>

      {/* قائمة الأسماء لتحديد آخر متكلمين (حتى اثنين) */}
      <div className="rounded-2xl p-4 mb-6" style={{ background: "#0F141C", border: "1px solid #1E2733" }}>
        <div className="text-xs mb-3 text-center" style={{ color: "#8A93A6" }}>
          اضغط على لاعب أو اثنين ليكونوا آخر من يتكلم
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          {nameList.map((p) => {
            const isLast = room.last_speaker_ids?.includes(p.id);
            const idx = room.speaking_order.indexOf(p.id);
            const hasSpoken =
              idx > -1 && idx <= room.speaking_index && room.speaking_turn_started_at !== null;
            // لون محايد بحت — بدون أي إشارة للفريق حتى بهذي الصفحة الخاصة بالحكم
            const iconColor = isLast ? "#E05A4A" : hasSpoken ? "#3A4150" : "#8A93A6";
            return (
              <button
                key={p.id}
                onClick={() => toggleLastSpeaker(p.id)}
                className="flex items-center gap-2 pr-4 pl-2 py-1.5 rounded-full"
                style={{
                  background: isLast ? "#8B263533" : "#141B26",
                  border: `1px solid ${isLast ? "#8B263566" : "#2A3342"}`,
                }}
              >
                {p.role && <RoleIcon role={p.role} color={iconColor} size={22} />}
                <span
                  className="text-sm"
                  style={{
                    color: isLast ? "#E05A4A" : hasSpoken ? "#4A5264" : "#EDEAE0",
                  }}
                >
                  {p.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1" />
    </main>
  );
}
