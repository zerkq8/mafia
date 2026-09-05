"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [kicked, setKicked] = useState(false);
  const wasPlayerRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [starting, setStarting] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hostPlayer = players.find((p) => p.is_host) || null;
  const regularPlayers = players.filter((p) => !p.is_host);
  const me = players.find((p) => p.auth_id === myAuthId) || null;
  const isHost = !!(room && myAuthId && room.host_auth_id === myAuthId);

  const allReady =
    regularPlayers.length > 0 && regularPlayers.every((p) => p.is_ready);
  const isFull = room ? regularPlayers.length >= room.target_player_count : false;
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

      // إعادة الاتصال: لو اللعبة بدأت فعليًا وسوّينا Refresh لصفحة اللوبي القديمة،
      // ودّي كل واحد لمكانه الصحيح فورًا بدل ما يعلق بشاشة انتظار قديمة
      if (roomData.status !== "lobby") {
        const amHost = roomData.host_auth_id === session?.user.id;
        router.replace(`/room/${code}/${amHost ? "gm" : "role"}`);
        setLoading(false);
        return;
      }

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

      const freshPlayers = (playersData as PlayerRow[]) || [];
      setPlayers(freshPlayers);
      const mine = freshPlayers.find((p) => p.auth_id === session?.user.id);

      // لو كنا لاعبًا مسجّلًا قبل وصرنا مو موجودين بالقائمة الحين = تم طردنا
      if (!mine && wasPlayerRef.current) {
        setKicked(true);
      }
      if (mine) {
        setMyPlayerId(mine.id);
        wasPlayerRef.current = true;
      }
    } catch (e: any) {
      setError(e.message || "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  // نبضة حياة: تحدّث كل 20 ثانية طالما الصفحة مفتوحة — تُستخدم لتنظيف الغرف المهجورة
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
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          const newStatus = (payload.new as any)?.status;
          if (newStatus && newStatus !== "lobby") {
            router.push(`/room/${code}/${isHost ? "gm" : "role"}`);
          }
        }
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
          setError("تم إغلاق هذه الغرفة.");
          setRoom(null);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, myAuthId]);

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
      setActionError("تعذّر إغلاق الغرفة: " + delError.message);
      setClosing(false);
      return;
    }
    router.push("/");
  }

  async function startGame() {
    if (!room || !canStart) return;
    setStarting(true);
    setActionError("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/rooms/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomCode: code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "تعذّر بدء اللعبة.");
      router.push(`/room/${code}/gm`);
    } catch (e: any) {
      setActionError(e.message);
      setStarting(false);
    }
  }

  async function kickPlayer(player: PlayerRow) {
    if (!isHost) return;
    const ok = window.confirm(`هل تريد طرد "${player.name}" من الغرفة؟`);
    if (!ok) return;
    const supabase = getSupabaseBrowserClient();
    const { error: kickError } = await supabase
      .from("players")
      .delete()
      .eq("id", player.id);
    if (kickError) {
      setActionError("تعذّر طرد اللاعب: " + kickError.message);
    }
  }

  async function leaveRoom() {
    if (!me || isHost) return;
    const ok = window.confirm("هل تريد الخروج من الغرفة؟");
    if (!ok) return;
    const supabase = getSupabaseBrowserClient();
    const { error: leaveError } = await supabase
      .from("players")
      .delete()
      .eq("id", me.id);
    if (leaveError) {
      setActionError("تعذّر الخروج: " + leaveError.message);
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

  if (kicked) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-4">
        <p className="text-mafia text-sm text-center">
          تم إخراجك من هذه الغرفة من قبل الحكم.
        </p>
        <button
          onClick={() => router.push("/")}
          className="text-xs text-gold border border-gold rounded-full px-4 py-2"
        >
          رجوع للرئيسية
        </button>
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
  const slots = Array.from({ length: total }, (_, i) => regularPlayers[i] || null);

  async function shareRoom() {
    const url = `${window.location.origin}/join/${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "مافيا الكويت", text: "انضم لغرفتي", url });
      } catch {
        // المستخدم ألغى المشاركة — تجاهل
      }
    } else {
      await navigator.clipboard.writeText(url);
      window.alert("تم نسخ رابط الدعوة، أرسله للاعبين.");
    }
  }

  return (
    <main className="min-h-screen px-5 py-8 max-w-md mx-auto flex flex-col">
      {actionError && (
        <p className="text-mafia text-xs text-center mb-3">{actionError}</p>
      )}
      {/* صندوق الحكم — منفصل تمامًا عن عدّاد اللاعبين */}
      {hostPlayer && (
        <div className="flex justify-center mb-3">
          <div
            className="flex items-center gap-2 rounded-full px-5 py-2"
            style={{ background: "#FCEFC7", border: "1px solid #C9A227" }}
          >
            <span className="text-base">👑</span>
            <span className="text-sm font-bold" style={{ color: "#C9A227" }}>
              الحكم
            </span>
            <span className="text-sm" style={{ color: "#2B2117" }}>
              {hostPlayer.name}
            </span>
          </div>
        </div>
      )}

      {isHost && (
        <div className="flex justify-center mb-5">
          <button
            onClick={shareRoom}
            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-full"
            style={{ border: "1px solid #E6DFC8", color: "#8B7F68" }}
          >
            🔗 مشاركة رابط الدعوة
          </button>
        </div>
      )}

      {/* العدّاد بالنص فوق — dir=ltr لتفادي مشكلة انعكاس الأرقام بالـ RTL */}
      <div className="text-center mb-6">
        <div className="text-[10px] tracking-[0.3em] text-muted mb-1">
          عدد اللاعبين
        </div>
        <div
          dir="ltr"
          className="font-display text-4xl text-gold inline-block"
        >
          {regularPlayers.length}
          <span className="text-muted text-2xl mx-1">/</span>
          {total}
        </div>
        {isHost && (
          <p className="text-[10px] text-muted mt-2">
            اضغط على أي لاعب لطرده من الغرفة
          </p>
        )}
      </div>

      {/* شبكة المربعات — لاعبين فقط، بدون الحكم */}
      <div className="grid grid-cols-4 gap-2 mb-8">
        {slots.map((p, i) => {
          const filled = !!p;
          const isMe = p?.auth_id === myAuthId;
          return (
            <div
              key={i}
              onClick={() => {
                if (isHost && filled) kickPlayer(p!);
              }}
              className="aspect-square rounded-lg flex items-center justify-center text-center px-1"
              style={{
                background: filled ? "#FFFFFF" : "transparent",
                border: `1px solid ${
                  isMe ? "#C9A227" : filled ? "#E6DFC8" : "#F3ECDC"
                }`,
                cursor: isHost && filled ? "pointer" : "default",
              }}
            >
              {filled ? (
                <div className="flex flex-col items-center gap-1">
                  <span
                    className="text-[10px] leading-tight break-all"
                    style={{ color: isMe ? "#C9A227" : "#2B2117" }}
                  >
                    {p!.name}
                  </span>
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: p!.is_ready ? "#3FA37A" : "#C0392B",
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
        <>
          <button
            onClick={toggleReady}
            className="w-full rounded-xl py-3 text-sm font-bold mb-3"
            style={{
              background: me.is_ready ? "transparent" : "#C9A227",
              border: me.is_ready ? "1px solid #E6DFC8" : "none",
              color: me.is_ready ? "#8B7F68" : "#2B2117",
            }}
          >
            {me.is_ready ? "إلغاء الاستعداد" : "مستعد"}
          </button>
          <button
            onClick={leaveRoom}
            className="w-full rounded-xl py-3 text-xs font-bold"
            style={{
              background: "transparent",
              border: "1px solid #E6DFC8",
              color: "#8B7F68",
            }}
          >
            الخروج من الغرفة
          </button>
        </>
      )}

      {isHost && (
        <>
          <button
            disabled={!canStart || starting}
            onClick={startGame}
            className="w-full rounded-xl py-3 text-sm font-bold mb-3 disabled:opacity-40"
            style={{ background: "#C0392B", color: "#FFFFFF" }}
          >
            {starting
              ? "جارٍ توزيع الأدوار..."
              : !isFull
              ? `بانتظار اكتمال اللاعبين (${regularPlayers.length}/${total})`
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
              border: "1px solid #C0392B",
              color: "#C0392B",
            }}
          >
            {closing ? "جارٍ الإغلاق..." : "إغلاق الغرفة وحذفها"}
          </button>
        </>
      )}
    </main>
  );
}
