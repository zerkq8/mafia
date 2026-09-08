"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { VoiceChannel } from "@/lib/voiceChannel";

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

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
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
  const [leaving, setLeaving] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);

  // --- صوت غرفة الانتظار (جماعي، اختياري، شبكة كاملة بين كل الحاضرين) ---
  const voiceRef = useRef<VoiceChannel | null>(null);
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [micMuted, setMicMuted] = useState(false);
  const [listeningMuted, setListeningMuted] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

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

      const { data: chatData } = await supabase
        .from("online_chat_messages")
        .select("id, sender_name, message, created_at")
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true })
        .limit(100);
      setChatMessages((chatData as ChatMessage[]) || []);
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
            voiceRef.current?.stop();
            router.push(`/online/room/${code}/play`);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "online_chat_messages", filter: `room_id=eq.${room.id}` },
        (payload) => {
          setChatMessages((prev) => [...prev, payload.new as ChatMessage]);
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

  async function joinAsPlayer() {
    setActionError("");
    try {
      await callApi("/api/online/rooms/join-as-player", { roomCode: code });
    } catch (e: any) {
      setActionError(e.message);
    }
  }

  async function becomeSpectator() {
    if (!window.confirm("متأكد تبي تنزل مستمع؟ بتخسر مقعدك كلاعب.")) return;
    setActionError("");
    try {
      await callApi("/api/online/rooms/become-spectator", { roomCode: code });
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

  async function leaveRoom() {
    if (!window.confirm("متأكد تبي تطلع من الغرفة؟")) return;
    leaveLobbyVoice();
    setLeaving(true);
    setActionError("");
    try {
      await callApi("/api/online/rooms/leave", { roomCode: code });
      router.push("/online");
    } catch (e: any) {
      setActionError(e.message);
      setLeaving(false);
    }
  }

  async function shareRoom() {
    const url = `${window.location.origin}/online/join/${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "لعبة المافيا — أونلاين", text: "انضم لغرفتي", url });
      } catch {
        // ألغى المشاركة
      }
    } else {
      await navigator.clipboard.writeText(url);
      window.alert("تم نسخ رابط الدعوة، أرسله للاعبين.");
    }
  }

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || !room || !myPlayerId) return;
    setChatInput("");
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("online_chat_messages").insert({
      room_id: room.id,
      sender_player_id: myPlayerId,
      sender_name: me?.name || "لاعب",
      message: text.slice(0, 300),
    });
    if (error) setActionError("تعذّر إرسال الرسالة: " + error.message);
  }

  // ---- صوت غرفة الانتظار: شبكة كاملة (Mesh) بين كل الحاضرين ----
  async function joinLobbyVoice() {
    if (!room || !myPlayerId) return;
    setVoiceError("");
    const voice = new VoiceChannel(room.id, myPlayerId, setVoiceError);
    voiceRef.current = voice;
    // المستمعون يستمعون بس، ما يتكلمون — الباقي شبكة كاملة (كل واحد يتصل بالكل تلقائيًا عبر آلية hello)
    await voice.start(!me?.is_spectator);
    setVoiceJoined(true);
  }

  function leaveLobbyVoice() {
    voiceRef.current?.stop();
    voiceRef.current = null;
    setVoiceJoined(false);
    setMicMuted(false);
    setListeningMuted(false);
  }

  // تنظيف عند مغادرة الصفحة
  useEffect(() => {
    return () => {
      voiceRef.current?.stop();
    };
  }, []);

  // تحقق دوري هل انحظر تشغيل الصوت (Autoplay) — لإظهار زر تفعيل يدوي
  useEffect(() => {
    if (!voiceJoined) {
      setPlaybackBlocked(false);
      return;
    }
    const interval = setInterval(() => {
      setPlaybackBlocked(voiceRef.current?.isPlaybackBlocked() ?? false);
    }, 1000);
    return () => clearInterval(interval);
  }, [voiceJoined]);

  function retryAudioPlayback() {
    voiceRef.current?.retryPlayback();
    setPlaybackBlocked(false);
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
      {/* شريط علوي: رجوع + مشاركة */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={leaveRoom}
          disabled={leaving}
          className="text-xs px-3 py-2 rounded-full disabled:opacity-50"
          style={{ border: "1px solid #DED4B8", color: "#8B7F68" }}
        >
          ← رجوع
        </button>
        <button
          onClick={shareRoom}
          className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-full"
          style={{ border: "1px solid #C9A227", color: "#C9A227" }}
        >
          🔗 مشاركة رابط الدعوة
        </button>
      </div>

      <div className="text-center mb-2">
        {isCreator && <p className="text-[10px] text-gold mb-1">👑 أنت منشئ الغرفة</p>}
        <p dir="ltr" className="text-xs text-muted tracking-widest">{code}</p>
      </div>

      <div dir="ltr" className="text-center text-3xl font-display text-gold my-2">
        {activePlayers.length}<span className="text-muted text-xl mx-1">/</span>8
      </div>
      {spectators.length > 0 && (
        <p className="text-center text-xs mb-2" style={{ color: "#8B7F68" }}>
          👁️ {spectators.length} مستمع
        </p>
      )}

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

      {/* شبكة اللاعبين — نفس تصميم الوضع المحلي: اسم فوق، صورة رمادية/خضراء داخل المربع */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {slots.map((p, i) => (
          <div
            key={i}
            onClick={() => {
              if (isCreator && p && p.auth_id !== myAuthId) {
                setManagingPlayer(p);
              }
            }}
            className="flex flex-col items-center gap-1"
            style={{ cursor: isCreator && p && p.auth_id !== myAuthId ? "pointer" : "default" }}
          >
            {p && (
              <span
                className="text-[9px] leading-tight text-center break-all max-w-full px-0.5"
                style={{ color: p.auth_id === myAuthId ? "#C9A227" : "#2B2117" }}
              >
                {p.name}
              </span>
            )}
            <div
              className="aspect-square w-full rounded-lg flex items-center justify-center overflow-hidden"
              style={{
                background: p ? "#FFFFFF" : "transparent",
                border: `1px solid ${p?.auth_id === myAuthId ? "#C9A227" : p ? "#DED4B8" : "#EEE5D0"}`,
              }}
            >
              {p ? (
                <img
                  src={p.is_ready ? "/avatars/default-ready.png" : "/avatars/default-gray.png"}
                  alt=""
                  className="w-full h-full object-contain p-1.5"
                  style={{ transition: "opacity 0.3s ease" }}
                />
              ) : (
                <span className="text-border text-lg">·</span>
              )}
            </div>
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

      {/* صوت غرفة الانتظار — جماعي واختياري */}
      {voiceError && <p className="text-mafia text-xs text-center mb-2">{voiceError}</p>}
      {playbackBlocked && (
        <div className="flex justify-center mb-2">
          <button
            onClick={retryAudioPlayback}
            className="text-xs px-5 py-2.5 rounded-full font-bold animate-pulse"
            style={{ background: "#8B2635", color: "#EDEAE0" }}
          >
            🔊 اضغط لتفعيل الصوت
          </button>
        </div>
      )}
      <div className="flex items-center justify-center gap-2 mb-4">
        {!voiceJoined ? (
          <button
            onClick={joinLobbyVoice}
            className="text-xs px-5 py-2.5 rounded-full font-bold"
            style={{ background: "#C9A22733", border: "1px solid #C9A227", color: "#C9A227" }}
          >
            {me?.is_spectator ? "🎧 استمع لصوت الغرفة" : "🎙️ انضم لصوت الغرفة"}
          </button>
        ) : (
          <>
            <button
              onClick={leaveLobbyVoice}
              className="text-xs px-4 py-2 rounded-full font-bold"
              style={{ background: "#8B263533", border: "1px solid #8B2635", color: "#E05A4A" }}
            >
              مغادرة الصوت
            </button>
            {!me?.is_spectator && (
              <button
                onClick={() => {
                  const next = !micMuted;
                  setMicMuted(next);
                  voiceRef.current?.setMicMuted(next);
                }}
                className="text-xs px-4 py-2 rounded-full"
                style={{
                  background: micMuted ? "#8B263533" : "#FFFFFF",
                  border: `1px solid ${micMuted ? "#8B2635" : "#DED4B8"}`,
                  color: micMuted ? "#E05A4A" : "#8B7F68",
                }}
              >
                {micMuted ? "🔇 مكتوم" : "🎙️ كتم"}
              </button>
            )}
            <button
              onClick={() => {
                const next = !listeningMuted;
                setListeningMuted(next);
                voiceRef.current?.setListeningMuted(next);
              }}
              className="text-xs px-4 py-2 rounded-full"
              style={{
                background: listeningMuted ? "#8B263533" : "#FFFFFF",
                border: `1px solid ${listeningMuted ? "#8B2635" : "#DED4B8"}`,
                color: listeningMuted ? "#E05A4A" : "#8B7F68",
              }}
            >
              {listeningMuted ? "🔇 مكتوم" : "🔊 السماع"}
            </button>
          </>
        )}
      </div>

      {me && !me.is_spectator && (
        <>
          <button
            onClick={toggleReady}
            className="w-full rounded-xl py-3 text-sm font-bold"
            style={{
              background: me.is_ready ? "transparent" : "#C9A227",
              border: me.is_ready ? "1px solid #DED4B8" : "none",
              color: me.is_ready ? "#8B7F68" : "#2B2117",
            }}
          >
            {me.is_ready ? "إلغاء الاستعداد" : "مستعد"}
          </button>
          <button
            onClick={becomeSpectator}
            className="w-full text-xs text-center py-2 mt-2"
            style={{ color: "#8B7F68" }}
          >
            🔽 انزل كمستمع
          </button>
        </>
      )}
      {me && me.is_spectator && (
        <div className="text-center mb-2">
          <p className="text-xs mb-2" style={{ color: "#8A93A6" }}>
            أنت مستمع — بتقدر تتفرج وتدردش وتسمع الصوت لما تبدأ اللعبة
          </p>
          {activePlayers.length < 8 && (
            <button
              onClick={joinAsPlayer}
              className="text-xs px-4 py-2 rounded-full font-bold"
              style={{ background: "#C9A227", color: "#2B2117" }}
            >
              🔼 انضم كلاعب ({8 - activePlayers.length} مقاعد فاضية)
            </button>
          )}
        </div>
      )}

      {/* الدردشة */}
      <div className="mt-4">
        <button
          onClick={() => setShowChat((v) => !v)}
          className="w-full text-xs text-center py-2 rounded-full"
          style={{ border: "1px solid #DED4B8", color: "#8B7F68" }}
        >
          💬 {showChat ? "إخفاء الدردشة" : `الدردشة (${chatMessages.length})`}
        </button>

        {showChat && (
          <div className="mt-3 rounded-2xl p-3" style={{ background: "#FFFFFF", border: "1px solid #DED4B8" }}>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto mb-2">
              {chatMessages.length === 0 && (
                <p className="text-[11px] text-center py-4" style={{ color: "#B8AD95" }}>
                  ما فيه رسائل بعد
                </p>
              )}
              {chatMessages.map((m) => (
                <div key={m.id} className="text-xs">
                  <span className="font-bold" style={{ color: "#C9A227" }}>{m.sender_name}: </span>
                  <span style={{ color: "#2B2117" }}>{m.message}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
                maxLength={300}
                placeholder="اكتب رسالة..."
                className="flex-1 rounded-lg px-3 py-2 text-xs bg-transparent outline-none"
                style={{ border: "1px solid #DED4B8", color: "#2B2117" }}
              />
              <button
                onClick={sendChatMessage}
                className="text-xs px-4 rounded-lg font-bold"
                style={{ background: "#C9A227", color: "#0B0E14" }}
              >
                إرسال
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
