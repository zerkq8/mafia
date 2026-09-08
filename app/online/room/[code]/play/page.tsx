"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { VoiceChannel } from "@/lib/voiceChannel";

type RoleKey = "mafia" | "doctor" | "detective" | "civilian";

interface RoomRow {
  id: string;
  status: string;
  round_number: number;
  last_death_player_id: string | null;
  role_reveal_started_at: string | null;
  mafia_recognition_started_at: string | null;
  current_speaker_id: string | null;
  speaking_started_at: string | null;
  day_vote_started_at: string | null;
  winner: string | null;
  last_voted_out_player_id: string | null;
  speaking_order: string[];
  speaking_index: number;
}

interface PlayerRow {
  id: string;
  name: string;
  is_alive: boolean;
  auth_id: string;
  is_spectator: boolean;
  seat_number: number | null;
  seat_side: string | null;
}

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
}

const ROLE_NAME: Record<RoleKey, string> = {
  mafia: "المافيا",
  doctor: "الطبيب",
  detective: "الشرطي",
  civilian: "الشعب",
};

const ROLE_IMAGE: Record<RoleKey, string> = {
  mafia: "/roles/color-sm/mafia.png",
  doctor: "/roles/color-sm/doctor.png",
  detective: "/roles/color-sm/detective.png",
  civilian: "/roles/color-sm/civilian.png",
};

const ROLE_REVEAL_CARD: Record<RoleKey, string> = {
  mafia: "/roles/reveal-cards/mafia.jpg",
  doctor: "/roles/reveal-cards/doctor.jpg",
  detective: "/roles/reveal-cards/detective.jpg",
  civilian: "/roles/reveal-cards/civilian.jpg",
};

export default function OnlinePlayPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [myAuthId, setMyAuthId] = useState<string | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<RoleKey | null>(null);
  const [myAlive, setMyAlive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [investigationResult, setInvestigationResult] = useState<{
    name: string;
    role: RoleKey;
  } | null>(null);
  const [teamMembers, setTeamMembers] = useState<{ player_id: string; name: string }[]>([]);
  const [showTeam, setShowTeam] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);

  // --- الصوت ---
  const voiceRef = useRef<VoiceChannel | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [speakerLevel, setSpeakerLevel] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [listeningMuted, setListeningMuted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // --- الدردشة ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);

  // --- التصويت ---
  const [votes, setVotes] = useState<{ voter_player_id: string; target_player_id: string }[]>([]);
  const [myVoteTarget, setMyVoteTarget] = useState<string | null>(null);
  const [allRoles, setAllRoles] = useState<{ player_id: string; name: string; role: RoleKey }[]>([]);

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      setMyAuthId(session?.user.id ?? null);
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("online_rooms")
        .select(
          "id, status, round_number, last_death_player_id, role_reveal_started_at, mafia_recognition_started_at, current_speaker_id, speaking_started_at, day_vote_started_at, winner, last_voted_out_player_id, speaking_order, speaking_index"
        )
        .eq("code", code)
        .maybeSingle();
      if (roomError || !roomData) {
        setError("لم يتم العثور على الغرفة.");
        setLoading(false);
        return;
      }

      if (roomData.status === "waiting") {
        router.replace(`/online/room/${code}`);
        return;
      }
      setRoom(roomData as RoomRow);

      const { data: playersData } = await supabase
        .from("online_players")
        .select("id, name, is_alive, auth_id, is_spectator, seat_number, seat_side")
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true });
      setPlayers((playersData as PlayerRow[]) || []);

      const mine = (playersData as PlayerRow[] | null)?.find(
        (p) => p.auth_id === session?.user.id
      );
      if (mine) {
        setMyPlayerId(mine.id);
        setMyAlive(mine.is_alive);
        setIsSpectator(mine.is_spectator);
      }

      // المستمعون ما عندهم دور أصلاً — نتجاوز طلب الدور لهم
      if (mine && !mine.is_spectator) {
        const { data: roleData } = await supabase.rpc("get_my_online_role", {
          p_room_id: roomData.id,
        });
        const roleRow = Array.isArray(roleData) ? roleData[0] : roleData;
        if (roleRow) {
          setMyRole(roleRow.role as RoleKey);
          setMyAlive(roleRow.is_alive);
        }
      }

      // تحقق هل سبق وأرسلت فعلك بهذي المرحلة (بعد Refresh مثلًا)
      const actionTypeForPhase: Record<string, string> = {
        mafia_phase: "mafia_kill",
        detective_phase: "detective_investigate",
        doctor_phase: "doctor_protect",
      };
      const expectedAction = actionTypeForPhase[roomData.status];
      if (expectedAction && mine) {
        const { data: existingAction } = await supabase
          .from("online_night_actions")
          .select("target_player_id")
          .eq("room_id", roomData.id)
          .eq("round_number", roomData.round_number)
          .eq("action_type", expectedAction)
          .eq("actor_player_id", mine.id)
          .maybeSingle();
        if (existingAction) {
          setSubmitted(true);
          setSelectedTarget(existingAction.target_player_id);
          if (expectedAction === "detective_investigate") {
            const { data } = await supabase.rpc("get_online_investigation_result", {
              p_room_id: roomData.id,
              p_round: roomData.round_number,
            });
            const row = Array.isArray(data) ? data[0] : data;
            if (row) setInvestigationResult({ name: row.target_name, role: row.target_role });
          }
        }
      }

      const { data: chatData } = await supabase
        .from("online_chat_messages")
        .select("id, sender_name, message, created_at")
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true })
        .limit(100);
      setChatMessages((chatData as ChatMessage[]) || []);

      if (roomData.status === "day_vote" || roomData.status === "game_over") {
        const { data: votesData } = await supabase
          .from("online_day_votes")
          .select("voter_player_id, target_player_id")
          .eq("room_id", roomData.id)
          .eq("round_number", roomData.round_number);
        setVotes(votesData || []);
        const myVote = (votesData || []).find((v) => v.voter_player_id === mine?.id);
        if (myVote) setMyVoteTarget(myVote.target_player_id);
      }

      if (roomData.status === "game_over") {
        const { data: rolesData } = await supabase.rpc("get_all_online_roles_if_game_over", {
          p_room_id: roomData.id,
        });
        setAllRoles(rolesData || []);
      }
    } catch (e: any) {
      setError(e.message || "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }, [code, router]);

  useEffect(() => {
    load();
  }, [load]);

  const prevStatusRef = useRef<string | null>(null);

  // تحقق دوري هل انحظر تشغيل الصوت تلقائيًا — لإظهار زر تفعيل يدوي
  useEffect(() => {
    const active = room?.status === "mafia_recognition" || room?.status === "speaking_turn";
    if (!active) {
      setPlaybackBlocked(false);
      return;
    }
    const interval = setInterval(() => {
      setPlaybackBlocked(voiceRef.current?.isPlaybackBlocked() ?? false);
    }, 1000);
    return () => clearInterval(interval);
  }, [room?.status]);

  function retryAudioPlayback() {
    voiceRef.current?.retryPlayback();
    setPlaybackBlocked(false);
  }

  // ---- قراءة مستوى صوت المتكلم الحالي لحظيًا (لتحريك أيقونة المربع مع الصوت) ----
  useEffect(() => {
    if (room?.status !== "speaking_turn" || !room.current_speaker_id) {
      setSpeakerLevel(0);
      return;
    }
    const isMe = room.current_speaker_id === myPlayerId;
    const frame = setInterval(() => {
      const level = isMe
        ? voiceRef.current?.getAudioLevel() ?? 0
        : voiceRef.current?.getAudioLevel(room.current_speaker_id!) ?? 0;
      setSpeakerLevel(level);
    }, 120);
    return () => clearInterval(frame);
  }, [room?.status, room?.current_speaker_id, myPlayerId]);

  // إعادة تصفير حالة "أرسلت" بس عند تغيّر حقيقي بالمرحلة (مو أول تحميل، عشان ما يمسح استرجاع الحالة)
  useEffect(() => {
    if (!room) return;
    if (prevStatusRef.current !== null && prevStatusRef.current !== room.status) {
      setSelectedTarget(null);
      setSubmitted(false);
      setShowTeam(false);
      if (room.status !== "speaking_turn" && room.status !== "speaking_done") setInvestigationResult(null);
      if (room.status !== "day_vote") setMyVoteTarget(null);
    }
    prevStatusRef.current = room.status;
  }, [room?.status]);

  useEffect(() => {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`online-play-${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "online_rooms", filter: `id=eq.${room.id}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "online_players", filter: `room_id=eq.${room.id}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  // ---- الدردشة (قناة لحظية منفصلة عشان ما نعيد تحميل كل شي مع كل رسالة) ----
  useEffect(() => {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    const chatChannel = supabase
      .channel(`online-chat-${room.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "online_chat_messages", filter: `room_id=eq.${room.id}` },
        (payload) => {
          setChatMessages((prev) => [...prev, payload.new as ChatMessage]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(chatChannel);
    };
  }, [room?.id]);

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || !room || !myPlayerId) return;
    setChatInput("");
    const supabase = getSupabaseBrowserClient();
    const me = players.find((p) => p.id === myPlayerId);
    const { error } = await supabase.from("online_chat_messages").insert({
      room_id: room.id,
      sender_player_id: myPlayerId,
      sender_name: me?.name || "لاعب",
      message: text.slice(0, 300),
    });
    if (error) setActionError("تعذّر إرسال الرسالة: " + error.message);
  }

  // ---- التصويت (قناة لحظية) ----
  useEffect(() => {
    if (!room) return;
    const supabase = getSupabaseBrowserClient();
    const voteChannel = supabase
      .channel(`online-votes-${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "online_day_votes", filter: `room_id=eq.${room.id}` },
        () => {
          supabase
            .from("online_day_votes")
            .select("voter_player_id, target_player_id")
            .eq("room_id", room.id)
            .eq("round_number", room.round_number)
            .then(({ data }) => setVotes(data || []));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(voteChannel);
    };
  }, [room?.id, room?.round_number]);

  async function submitVote(targetPlayerId: string) {
    if (!room) return;
    setActionError("");
    setMyVoteTarget(targetPlayerId);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/online/rooms/submit-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode: code, targetPlayerId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "تعذّر التصويت.");
    } catch (e: any) {
      setActionError(e.message);
      setMyVoteTarget(null);
    }
  }

  // ---- مرحلة كشف الدور (5 ثواني، بدون صوت) ----
  useEffect(() => {
    if (!room || room.status !== "role_reveal" || isSpectator) return;

    let cancelled = false;
    const startedAt = new Date(room.role_reveal_started_at!).getTime();
    const timer = setInterval(async () => {
      if (cancelled) return;
      const remaining = Math.max(0, 5 - Math.floor((Date.now() - startedAt) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        try {
          const supabase = getSupabaseBrowserClient();
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token;
          await fetch("/api/online/rooms/advance-role-reveal", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ roomCode: code }),
          });
        } catch {
          // لاعب ثاني بيحاول برضه
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(timer);
      setCountdown(null);
    };
  }, [room?.status, isSpectator]);

  // ---- صوت المافيا الخاص (15 ثانية قبل أول ليلة) ----
  useEffect(() => {
    if (!room || room.status !== "mafia_recognition" || myRole !== "mafia" || !myAlive) return;
    if (!myPlayerId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.rpc("get_my_online_mafia_team", { p_room_id: room.id });
      const otherMafia = (data || []).find((m: any) => m.player_id !== myPlayerId);
      if (!otherMafia || cancelled) return;

      const voice = new VoiceChannel(room.id, myPlayerId, setVoiceError);
      voiceRef.current = voice;
      await voice.start();
      if (cancelled) return;
      setMicOn(true);

      // الطرف صاحب المعرّف الأصغر هو اللي يبدأ الاتصال (تجنّب اتصال مزدوج)
      if (myPlayerId < otherMafia.player_id) {
        await voice.callPeer(otherMafia.player_id);
      }

      const startedAt = new Date(room.mafia_recognition_started_at!).getTime();
      timer = setInterval(async () => {
        const remaining = Math.max(0, 15 - Math.floor((Date.now() - startedAt) / 1000));
        setCountdown(remaining);
        if (remaining <= 0) {
          if (timer) clearInterval(timer);
          try {
            const supabase2 = getSupabaseBrowserClient();
            const { data: sessionData } = await supabase2.auth.getSession();
            const token = sessionData.session?.access_token;
            await fetch("/api/online/rooms/advance-recognition", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ roomCode: code }),
            });
          } catch {
            // تجاهل — لاعب ثاني بيحاول برضه
          }
        }
      }, 500);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      voiceRef.current?.stop();
      voiceRef.current = null;
      setMicOn(false);
      setCountdown(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status, myRole, myAlive, myPlayerId]);

  // ---- صوت دور الكلام (35 ثانية بعد الإعلان الصباحي) ----
  useEffect(() => {
    if (!room || room.status !== "speaking_turn" || !myAlive || !myPlayerId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const isSpeaker = room.current_speaker_id === myPlayerId;

    (async () => {
      const voice = new VoiceChannel(room.id, myPlayerId, setVoiceError);
      voiceRef.current = voice;
      await voice.start(isSpeaker); // بس المتكلم الحالي يفتح ميكروفونه، الباقي استماع فقط
      if (cancelled) return;
      setMicOn(isSpeaker);

      if (isSpeaker) {
        const listeners = players.filter((p) => p.id !== myPlayerId);
        for (const listener of listeners) {
          await voice.callPeer(listener.id);
        }
      }

      const startedAt = new Date(room.speaking_started_at!).getTime();
      timer = setInterval(async () => {
        const remaining = Math.max(0, 35 - Math.floor((Date.now() - startedAt) / 1000));
        setCountdown(remaining);
        if (remaining <= 0) {
          if (timer) clearInterval(timer);
          try {
            const supabase2 = getSupabaseBrowserClient();
            const { data: sessionData } = await supabase2.auth.getSession();
            const token = sessionData.session?.access_token;
            await fetch("/api/online/rooms/advance-speaking", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ roomCode: code }),
            });
          } catch {
            // تجاهل
          }
        }
      }, 500);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      voiceRef.current?.stop();
      voiceRef.current = null;
      setMicOn(false);
      setCountdown(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status, room?.current_speaker_id, myAlive, myPlayerId]);

  async function submitAction(actionType: string) {
    if (!selectedTarget) return;
    setActionError("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/online/rooms/night-action", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode: code, actionType, targetPlayerId: selectedTarget }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "تعذّر تنفيذ الفعل.");
      setSubmitted(true);

      if (actionType === "detective_investigate" && room) {
        const { data } = await supabase.rpc("get_online_investigation_result", {
          p_room_id: room.id,
          p_round: room.round_number,
        });
        const row = Array.isArray(data) ? data[0] : data;
        if (row) setInvestigationResult({ name: row.target_name, role: row.target_role });
      }
    } catch (e: any) {
      setActionError(e.message);
    }
  }

  async function loadTeam() {
    if (!room) return;
    setShowTeam(true);
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.rpc("get_my_online_mafia_team", { p_room_id: room.id });
    if (data) setTeamMembers(data);
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

  if (!myAlive && room.status !== "game_over") {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-3"
        style={{ background: "#0A0000" }}
      >
        <div className="text-5xl mb-2">💀</div>
        <p className="text-2xl font-extrabold" style={{ color: "#E05A4A" }}>
          تم قتلك
        </p>
        <p className="text-xs text-center max-w-xs" style={{ color: "#8A93A6" }}>
          خرجت من اللعبة. تقدر تتفرج على الباقي.
        </p>
      </main>
    );
  }

  const alivePlayers = players.filter((p) => p.is_alive && !p.is_spectator);
  const isMyTurn =
    (room.status === "mafia_phase" && myRole === "mafia") ||
    (room.status === "detective_phase" && myRole === "detective") ||
    (room.status === "doctor_phase" && myRole === "doctor");

  const deadPlayer = room.last_death_player_id
    ? players.find((p) => p.id === room.last_death_player_id)
    : null;

  return (
    <main className="min-h-screen px-5 py-8 max-w-md mx-auto flex flex-col">
      <div className="text-center mb-6">
        <p className="text-[10px] tracking-[0.3em] text-muted mb-1">الجولة {room.round_number}</p>
        <p className="font-display text-2xl text-gold">
          {room.status === "role_reveal" && "🎴 كشف الأدوار"}
          {room.status === "mafia_recognition" && "🔴 المافيا تتعارف"}
          {room.status === "mafia_phase" && "🌙 مرحلة المافيا"}
          {room.status === "detective_phase" && "🌙 مرحلة الشرطي"}
          {room.status === "doctor_phase" && "🌙 مرحلة الطبيب"}
          {room.status === "speaking_turn" && "☀️ دور الكلام"}
          {room.status === "speaking_done" && "☀️ انتهى الكلام"}
          {room.status === "day_vote" && "🗳️ التصويت"}
          {room.status === "game_over" && "🏁 انتهت اللعبة"}
        </p>
        <p className="text-[11px] text-muted mt-1">
          {isSpectator ? "أنت مستمع/متفرج" : `دورك: ${myRole ? ROLE_NAME[myRole] : "—"}`}
        </p>
      </div>

      {actionError && <p className="text-mafia text-xs text-center mb-3">{actionError}</p>}
      {voiceError && <p className="text-mafia text-xs text-center mb-3">{voiceError}</p>}
      {playbackBlocked && (
        <div className="flex justify-center mb-3">
          <button
            onClick={retryAudioPlayback}
            className="text-xs px-5 py-2.5 rounded-full font-bold animate-pulse"
            style={{ background: "#8B2635", color: "#EDEAE0" }}
          >
            🔊 اضغط لتفعيل الصوت
          </button>
        </div>
      )}

      {/* بطاقة كشف الدور — 5 ثواني، بدون صوت */}
      {room.status === "role_reveal" && !isSpectator && myRole && (
        <div className="rounded-2xl overflow-hidden mb-5 text-center" style={{ border: "1px solid #2A3342" }}>
          <img
            src={ROLE_REVEAL_CARD[myRole]}
            alt={ROLE_NAME[myRole]}
            className="w-full"
            style={{ objectFit: "cover" }}
          />
          <div className="py-3" style={{ background: "#141B26" }}>
            <p dir="ltr" className="text-3xl font-display" style={{ color: "#C9A227" }}>
              {countdown ?? 5}
            </p>
          </div>
        </div>
      )}
      {room.status === "role_reveal" && isSpectator && (
        <p className="text-sm text-center py-10" style={{ color: "#8A93A6" }}>
          اللاعبون يشوفون أدوارهم الآن...
        </p>
      )}

      {/* ترتيب المقاعد — 4 يمين و4 يسار، بالاسم فوق ورقم المقعد داخل المربع */}
      {!["waiting", "role_reveal"].includes(room.status) && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          {["right", "left"].map((side) => (
            <div key={side} className="flex flex-col gap-1.5">
              {players
                .filter((p) => !p.is_spectator && p.seat_side === side)
                .sort((a, b) => (a.seat_number || 0) - (b.seat_number || 0))
                .map((p) => {
                  const isSpeakingNow =
                    room.status === "speaking_turn" && room.current_speaker_id === p.id;
                  const glow = isSpeakingNow ? 0.15 + speakerLevel * 0.6 : 0;
                  return (
                    <div key={p.id} className="flex flex-col items-center">
                      <span className="text-[9px] text-muted truncate max-w-full">{p.name}</span>
                      <div
                        className="relative w-full aspect-square rounded-md flex items-center justify-center text-sm font-bold"
                        style={{
                          background: isSpeakingNow ? "#C9A22733" : "#141B26",
                          border: `1px solid ${
                            p.id === myPlayerId ? "#C9A227" : isSpeakingNow ? "#C9A227" : "#2A3342"
                          }`,
                          color: p.is_alive ? "#EDEAE0" : "#4A5264",
                          opacity: p.is_alive ? 1 : 0.5,
                          boxShadow: isSpeakingNow ? `0 0 ${10 + glow * 22}px ${glow}px #C9A227` : "none",
                          transform: isSpeakingNow ? `scale(${1 + speakerLevel * 0.06})` : "scale(1)",
                          transition: "transform 0.1s ease, box-shadow 0.1s ease",
                        }}
                      >
                        {p.seat_number}
                        {isSpeakingNow && (
                          <span
                            className="absolute -top-1.5 -left-1.5 text-[10px] rounded-full flex items-center justify-center"
                            style={{
                              width: 16,
                              height: 16,
                              background: "#C9A227",
                              transform: `scale(${1 + speakerLevel * 0.5})`,
                              transition: "transform 0.1s ease",
                            }}
                          >
                            🎙️
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}

      {/* أزرار كتم الصوت — تظهر بس وقت وجود اتصال صوتي فعلي */}
      {micOn && (
        <div className="flex items-center justify-center gap-3 mb-4">
          <button
            onClick={() => {
              const next = !micMuted;
              setMicMuted(next);
              voiceRef.current?.setMicMuted(next);
            }}
            className="text-xs px-4 py-2 rounded-full"
            style={{
              background: micMuted ? "#8B263533" : "#141B26",
              border: `1px solid ${micMuted ? "#8B2635" : "#2A3342"}`,
              color: micMuted ? "#E05A4A" : "#8A93A6",
            }}
          >
            {micMuted ? "🔇 الميكروفون مكتوم" : "🎙️ كتم الميكروفون"}
          </button>
          <button
            onClick={() => {
              const next = !listeningMuted;
              setListeningMuted(next);
              voiceRef.current?.setListeningMuted(next);
            }}
            className="text-xs px-4 py-2 rounded-full"
            style={{
              background: listeningMuted ? "#8B263533" : "#141B26",
              border: `1px solid ${listeningMuted ? "#8B2635" : "#2A3342"}`,
              color: listeningMuted ? "#E05A4A" : "#8A93A6",
            }}
          >
            {listeningMuted ? "🔇 السماع مكتوم" : "🔊 كتم السماع"}
          </button>
        </div>
      )}

      {room.status === "mafia_recognition" && (
        <div className="rounded-2xl p-6 mb-5 text-center" style={{ background: "#141B26", border: "1px solid #2A3342" }}>
          {myRole === "mafia" ? (
            <>
              <p className="text-sm mb-2" style={{ color: "#EDEAE0" }}>
                {micOn ? "🎙️ الميكروفون شغّال — تكلم مع شريكك الآن" : "جارٍ فتح الاتصال الصوتي..."}
              </p>
              <p dir="ltr" className="text-4xl font-display" style={{ color: "#C9A227" }}>
                {countdown ?? 15}
              </p>
            </>
          ) : (
            <p className="text-sm" style={{ color: "#8A93A6" }}>
              المافيا يتعارفون على بعض الآن بالسر... 🤫
            </p>
          )}
        </div>
      )}

      {(room.status === "speaking_turn" || room.status === "speaking_done") && (
        <div className="rounded-2xl p-6 mb-5 text-center" style={{ background: "#141B26", border: "1px solid #2A3342" }}>
          {room.round_number === 1 ? (
            <p className="text-sm mb-3" style={{ color: "#EDEAE0" }}>
              الجولة الأولى — تعارف بس، بدون قتل الليلة.
            </p>
          ) : deadPlayer ? (
            <p className="text-sm mb-3" style={{ color: "#EDEAE0" }}>
              تم العثور على <span className="font-bold" style={{ color: "#E05A4A" }}>{deadPlayer.name}</span> مقتولًا الليلة.
            </p>
          ) : (
            <p className="text-sm mb-3" style={{ color: "#EDEAE0" }}>لم يمت أحد الليلة! 🎉</p>
          )}

          {room.status === "speaking_turn" && (
            <>
              <p className="text-xs mb-1" style={{ color: "#8A93A6" }}>
                يتكلم الآن — دور {room.speaking_index + 1} من {room.speaking_order?.length || 0}
              </p>
              <p className="text-lg font-bold mb-2" style={{ color: "#C9A227" }}>
                {(() => {
                  const speaker = players.find((p) => p.id === room.current_speaker_id);
                  return speaker
                    ? `${speaker.name}${speaker.seat_number ? ` (مقعد ${speaker.seat_number})` : ""}`
                    : "—";
                })()}
                {room.current_speaker_id === myPlayerId && " — أنت"}
              </p>
              <p dir="ltr" className="text-3xl font-display" style={{ color: "#C9A227" }}>
                {countdown ?? 35}
              </p>
              {room.current_speaker_id === myPlayerId && (
                <p className="text-[11px] mt-2" style={{ color: "#8A93A6" }}>
                  {micOn ? "🎙️ صوتك يوصل لجميع الحاضرين الآن" : "جارٍ فتح الميكروفون..."}
                </p>
              )}
            </>
          )}
          {room.status === "speaking_done" && (
            <p className="text-xs" style={{ color: "#8A93A6" }}>
              جارٍ فتح التصويت...
            </p>
          )}
        </div>
      )}

      {/* التصويت النهاري — علني، الكل يشوف مين صوّت لمين لحظيًا */}
      {room.status === "day_vote" && (
        <div className="rounded-2xl p-4 mb-5" style={{ background: "#141B26", border: "1px solid #2A3342" }}>
          <p className="text-xs text-center mb-3" style={{ color: "#8A93A6" }}>
            {isSpectator || !myAlive
              ? "التصويت جارٍ..."
              : myVoteTarget
              ? "صوّتك سُجّل — تقدر تغيّره لين ما يصوّت الكل"
              : "صوّت لطرد لاعب"}
          </p>
          <div className="flex flex-col gap-1.5">
            {alivePlayers.map((p) => {
              const voteCount = votes.filter((v) => v.target_player_id === p.id).length;
              const votersNames = votes
                .filter((v) => v.target_player_id === p.id)
                .map((v) => players.find((pp) => pp.id === v.voter_player_id)?.name)
                .filter(Boolean)
                .join("، ");
              return (
                <button
                  key={p.id}
                  disabled={isSpectator || !myAlive}
                  onClick={() => submitVote(p.id)}
                  className="text-sm px-4 py-2.5 rounded-lg text-right flex items-center justify-between disabled:opacity-60"
                  style={{
                    background: myVoteTarget === p.id ? "#C9A22733" : "#0F141C",
                    border: `1px solid ${myVoteTarget === p.id ? "#C9A227" : "#2A3342"}`,
                    color: "#EDEAE0",
                  }}
                >
                  <span className="flex flex-col items-start">
                    <span>{p.name}</span>
                    {votersNames && (
                      <span className="text-[9px]" style={{ color: "#5A6270" }}>
                        صوّت له: {votersNames}
                      </span>
                    )}
                  </span>
                  {voteCount > 0 && (
                    <span
                      className="text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center"
                      style={{ background: "#8B2635", color: "#EDEAE0" }}
                    >
                      {voteCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* نهاية اللعبة */}
      {room.status === "game_over" && (
        <div className="rounded-2xl p-6 mb-5 text-center" style={{ background: "#141B26", border: "1px solid #2A3342" }}>
          <p className="text-3xl mb-2">{room.winner === "mafia" ? "🔴" : "👥"}</p>
          <p className="text-xl font-bold mb-4" style={{ color: room.winner === "mafia" ? "#C0392B" : "#3FA37A" }}>
            {room.winner === "mafia" ? "فازت المافيا!" : "فاز الشعب!"}
          </p>
          <div className="flex flex-col gap-1.5 text-right">
            {allRoles.map((r) => (
              <div key={r.player_id} className="flex justify-between text-xs px-2">
                <span style={{ color: "#EDEAE0" }}>{r.name}</span>
                <span style={{ color: r.role === "mafia" ? "#C0392B" : "#8A93A6" }}>
                  {ROLE_NAME[r.role]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isMyTurn && !submitted && (
        <div className="rounded-2xl p-4 mb-5" style={{ background: "#141B26", border: "1px solid #2A3342" }}>
          <p className="text-xs text-muted mb-3 text-center">
            {myRole === "mafia" && "اختر ضحية لهذي الليلة"}
            {myRole === "detective" && "اختر لاعبًا للتحقيق فيه"}
            {myRole === "doctor" && "اختر لاعبًا لحمايته (تقدر تحمي نفسك)"}
          </p>
          <div className="flex flex-col gap-1.5 mb-3">
            {(myRole === "doctor" ? alivePlayers : alivePlayers.filter((p) => p.id !== myPlayerId)).map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedTarget(p.id)}
                className="text-sm px-4 py-2.5 rounded-lg text-right"
                style={{
                  background: selectedTarget === p.id ? "#C9A22733" : "#0F141C",
                  border: `1px solid ${selectedTarget === p.id ? "#C9A227" : "#2A3342"}`,
                  color: "#EDEAE0",
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <button
            disabled={!selectedTarget}
            onClick={() =>
              submitAction(
                myRole === "mafia"
                  ? "mafia_kill"
                  : myRole === "detective"
                  ? "detective_investigate"
                  : "doctor_protect"
              )
            }
            className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-40"
            style={{ background: "#C9A227", color: "#0B0E14" }}
          >
            تأكيد
          </button>
        </div>
      )}

      {isMyTurn && submitted && myRole !== "detective" && (
        <p className="text-sm text-center py-6" style={{ color: "#8A93A6" }}>
          تم إرسال اختيارك، بانتظار البقية...
        </p>
      )}

      {submitted && myRole === "detective" && investigationResult && (
        <div className="rounded-2xl p-6 mb-5 text-center" style={{ background: "#141B26", border: "1px solid #2A3342" }}>
          <p className="text-xs text-muted mb-2">نتيجة التحقيق في {investigationResult.name}</p>
          <p className="text-2xl font-bold" style={{ color: investigationResult.role === "mafia" ? "#C0392B" : "#3FA37A" }}>
            {investigationResult.role === "mafia" ? "🔴 مافيا" : "👥 شعب"}
          </p>
        </div>
      )}

      {!isMyTurn &&
        !["mafia_recognition", "speaking_turn", "speaking_done", "day_vote", "game_over", "role_reveal"].includes(
          room.status
        ) && (
        <p className="text-sm text-center py-10" style={{ color: "#8A93A6" }}>
          الجميع نايم... بانتظار بقية الأدوار
        </p>
      )}

      {["speaking_turn", "speaking_done", "day_vote", "game_over"].includes(room.status) &&
        myRole === "mafia" && (
        <div className="mt-2">
          {!showTeam ? (
            <button
              onClick={loadTeam}
              className="w-full rounded-full py-3 text-sm font-bold"
              style={{ background: "#8B2635", color: "#EDEAE0" }}
            >
              🔴 أعضاء فريقك
            </button>
          ) : (
            <div className="rounded-xl p-4" style={{ background: "#1E1215", border: "1px solid #8B263555" }}>
              {teamMembers.map((m) => (
                <p key={m.player_id} className="text-sm" style={{ color: "#EDEAE0" }}>
                  {m.name}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* الدردشة العامة — للاعبين والمستمعين */}
      <div className="mt-6">
        <button
          onClick={() => setShowChat((v) => !v)}
          className="w-full text-xs text-center py-2 rounded-full"
          style={{ border: "1px solid #2A3342", color: "#8A93A6" }}
        >
          💬 {showChat ? "إخفاء الدردشة" : `الدردشة (${chatMessages.length})`}
        </button>

        {showChat && (
          <div className="mt-3 rounded-2xl p-3" style={{ background: "#141B26", border: "1px solid #2A3342" }}>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto mb-2">
              {chatMessages.length === 0 && (
                <p className="text-[11px] text-center py-4" style={{ color: "#5A6270" }}>
                  ما فيه رسائل بعد
                </p>
              )}
              {chatMessages.map((m) => (
                <div key={m.id} className="text-xs">
                  <span className="font-bold" style={{ color: "#C9A227" }}>{m.sender_name}: </span>
                  <span style={{ color: "#EDEAE0" }}>{m.message}</span>
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
                style={{ border: "1px solid #2A3342", color: "#EDEAE0" }}
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
