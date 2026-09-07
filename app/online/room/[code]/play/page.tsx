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
  mafia_recognition_started_at: string | null;
  current_speaker_id: string | null;
  speaking_started_at: string | null;
}

interface PlayerRow {
  id: string;
  name: string;
  is_alive: boolean;
  auth_id: string;
}

const ROLE_NAME: Record<RoleKey, string> = {
  mafia: "المافيا",
  doctor: "الطبيب",
  detective: "الشرطي",
  civilian: "الشعب",
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

  // --- الصوت ---
  const voiceRef = useRef<VoiceChannel | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const session = await ensureAnonymousSession();
      setMyAuthId(session?.user.id ?? null);
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from("online_rooms")
        .select(
          "id, status, round_number, last_death_player_id, mafia_recognition_started_at, current_speaker_id, speaking_started_at"
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
        .select("id, name, is_alive, auth_id")
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true });
      setPlayers((playersData as PlayerRow[]) || []);

      const mine = (playersData as PlayerRow[] | null)?.find(
        (p) => p.auth_id === session?.user.id
      );
      if (mine) {
        setMyPlayerId(mine.id);
        setMyAlive(mine.is_alive);
      }

      const { data: roleData } = await supabase.rpc("get_my_online_role", {
        p_room_id: roomData.id,
      });
      const roleRow = Array.isArray(roleData) ? roleData[0] : roleData;
      let currentRole: RoleKey | null = null;
      if (roleRow) {
        currentRole = roleRow.role as RoleKey;
        setMyRole(currentRole);
        setMyAlive(roleRow.is_alive);
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

  // إعادة تصفير حالة "أرسلت" بس عند تغيّر حقيقي بالمرحلة (مو أول تحميل، عشان ما يمسح استرجاع الحالة)
  useEffect(() => {
    if (!room) return;
    if (prevStatusRef.current !== null && prevStatusRef.current !== room.status) {
      setSelectedTarget(null);
      setSubmitted(false);
      setShowTeam(false);
      if (room.status !== "speaking_turn" && room.status !== "speaking_done") setInvestigationResult(null);
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
      await voice.start();
      if (cancelled) return;
      setMicOn(true);

      if (isSpeaker) {
        const listeners = players.filter((p) => p.is_alive && p.id !== myPlayerId);
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
  }, [room?.status, myAlive, myPlayerId]);

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

  if (!myAlive) {
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

  const alivePlayers = players.filter((p) => p.is_alive);
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
          {room.status === "mafia_recognition" && "🔴 المافيا تتعارف"}
          {room.status === "mafia_phase" && "🌙 مرحلة المافيا"}
          {room.status === "detective_phase" && "🌙 مرحلة الشرطي"}
          {room.status === "doctor_phase" && "🌙 مرحلة الطبيب"}
          {room.status === "speaking_turn" && "☀️ دور الكلام"}
          {room.status === "speaking_done" && "☀️ انتهى الكلام"}
        </p>
        <p className="text-[11px] text-muted mt-1">دورك: {myRole ? ROLE_NAME[myRole] : "—"}</p>
      </div>

      {actionError && <p className="text-mafia text-xs text-center mb-3">{actionError}</p>}
      {voiceError && <p className="text-mafia text-xs text-center mb-3">{voiceError}</p>}

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
          {deadPlayer ? (
            <p className="text-sm mb-3" style={{ color: "#EDEAE0" }}>
              تم العثور على <span className="font-bold" style={{ color: "#E05A4A" }}>{deadPlayer.name}</span> مقتولًا الليلة.
            </p>
          ) : (
            <p className="text-sm mb-3" style={{ color: "#EDEAE0" }}>لم يمت أحد الليلة! 🎉</p>
          )}

          {room.status === "speaking_turn" && (
            <>
              <p className="text-xs mb-1" style={{ color: "#8A93A6" }}>يتكلم الآن</p>
              <p className="text-lg font-bold mb-2" style={{ color: "#C9A227" }}>
                {players.find((p) => p.id === room.current_speaker_id)?.name || "—"}
                {room.current_speaker_id === myPlayerId && " (أنت)"}
              </p>
              <p dir="ltr" className="text-3xl font-display" style={{ color: "#C9A227" }}>
                {countdown ?? 35}
              </p>
              {room.current_speaker_id === myPlayerId && (
                <p className="text-[11px] mt-2" style={{ color: "#8A93A6" }}>
                  {micOn ? "🎙️ صوتك يوصل لجميع الأحياء الآن" : "جارٍ فتح الميكروفون..."}
                </p>
              )}
            </>
          )}
          {room.status === "speaking_done" && (
            <p className="text-xs" style={{ color: "#8A93A6" }}>
              انتهت الجولة الحالية من اللعبة (التصويت قريبًا).
            </p>
          )}
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
        !["mafia_recognition", "speaking_turn", "speaking_done"].includes(room.status) && (
        <p className="text-sm text-center py-10" style={{ color: "#8A93A6" }}>
          الجميع نايم... بانتظار بقية الأدوار
        </p>
      )}

      {(room.status === "speaking_turn" || room.status === "speaking_done") && myRole === "mafia" && (
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
    </main>
  );
}
