"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ensureAnonymousSession,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";
import { ROLES, RoleKey, TeamKey } from "@/lib/roles";
import RoleIcon from "@/components/icons/RoleIcon";
import LocalVotingScreen from "@/components/LocalVotingScreen";
import LocalDiscussionScreen from "@/components/LocalDiscussionScreen";
import LocalSniperRevengeScreen from "@/components/LocalSniperRevengeScreen";
import LocalGameOverScreen from "@/components/LocalGameOverScreen";

/** رسمة ظهر البطاقة — نمط زخرفي محايد بحت (أبيض/أسود) قبل الكشف */
function CardBackArt() {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 200 267"
      preserveAspectRatio="xMidYMid slice"
      style={{ opacity: 0.5 }}
    >
      <defs>
        <pattern
          id="sadu"
          width="28"
          height="16"
          patternUnits="userSpaceOnUse"
        >
          <polyline
            points="0,16 7,0 14,16 21,0 28,16"
            fill="none"
            stroke="#5A5A5A"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect x="10" y="10" width="180" height="247" fill="url(#sadu)" opacity="0.35" />
      <rect
        x="16"
        y="16"
        width="168"
        height="235"
        rx="10"
        fill="none"
        stroke="#6B6B6B"
        strokeWidth="1"
      />
      <g transform="translate(100,133.5)" stroke="#7A7A7A" strokeWidth="1.2" fill="none">
        <rect x="-20" y="-20" width="40" height="40" transform="rotate(45)" />
        <rect x="-10" y="-10" width="20" height="20" transform="rotate(45)" />
      </g>
    </svg>
  );
}

interface TeamMember {
  player_id: string;
  name: string;
  role: RoleKey;
}

export default function RoleRevealPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myName, setMyName] = useState("");
  const [isAlive, setIsAlive] = useState(true);
  const [role, setRole] = useState<RoleKey | null>(null);
  const [team, setTeam] = useState<TeamKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 0 = الستارة مغلقة تمامًا (الدور مخفي)، 1 = مفتوحة تمامًا (الدور ظاهر)
  const [curtain, setCurtain] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sheenKey, setSheenKey] = useState(0);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startCurtain = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showTeam, setShowTeam] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  const [votingPhase, setVotingPhase] = useState("idle");
  const [votingOrder, setVotingOrder] = useState<string[]>([]);
  const [votingIndex, setVotingIndex] = useState(-1);
  const [votingTurnStartedAt, setVotingTurnStartedAt] = useState<string | null>(null);
  const [votingResultStartedAt, setVotingResultStartedAt] = useState<string | null>(null);
  const [votingEliminatedPlayerId, setVotingEliminatedPlayerId] = useState<string | null>(null);
  const [votingTie, setVotingTie] = useState(false);
  const [roundNumber, setRoundNumber] = useState(1);
  const [roomPlayers, setRoomPlayers] = useState<{ id: string; name: string; is_alive: boolean }[]>([]);

  const [discussionPhase, setDiscussionPhase] = useState("idle");
  const [discussionOrder, setDiscussionOrder] = useState<string[]>([]);
  const [discussionIndex, setDiscussionIndex] = useState(-1);
  const [discussionTurnStartedAt, setDiscussionTurnStartedAt] = useState<string | null>(null);
  const [discussionPausedAt, setDiscussionPausedAt] = useState<string | null>(null);
  const [discussionTotalPausedSeconds, setDiscussionTotalPausedSeconds] = useState(0);

  const [sniperPhase, setSniperPhase] = useState("idle");
  const [sniperSniperId, setSniperSniperId] = useState<string | null>(null);
  const [sniperStartedAt, setSniperStartedAt] = useState<string | null>(null);
  const [sniperVictimId, setSniperVictimId] = useState<string | null>(null);
  const [sniperResultStartedAt, setSniperResultStartedAt] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureAnonymousSession();
        const supabase = getSupabaseBrowserClient();

        const { data: room, error: roomError } = await supabase
          .from("rooms")
          .select(
            "id, round_number, voting_phase, voting_order, voting_index, voting_turn_started_at, voting_result_started_at, voting_eliminated_player_id, voting_tie, discussion_phase, discussion_order, discussion_index, discussion_turn_started_at, discussion_paused_at, discussion_total_paused_seconds, sniper_revenge_phase, sniper_revenge_sniper_id, sniper_revenge_started_at, sniper_revenge_victim_id, sniper_revenge_result_started_at, winner"
          )
          .eq("code", code)
          .maybeSingle();

        if (roomError || !room) {
          setError("لم يتم العثور على الغرفة.");
          setLoading(false);
          return;
        }
        setRoomId(room.id);
        setRoundNumber(room.round_number);
        setVotingPhase(room.voting_phase);
        setVotingOrder(room.voting_order || []);
        setVotingIndex(room.voting_index);
        setVotingTurnStartedAt(room.voting_turn_started_at);
        setVotingResultStartedAt(room.voting_result_started_at);
        setVotingEliminatedPlayerId(room.voting_eliminated_player_id);
        setVotingTie(room.voting_tie);
        setDiscussionPhase(room.discussion_phase);
        setDiscussionOrder(room.discussion_order || []);
        setDiscussionIndex(room.discussion_index);
        setDiscussionTurnStartedAt(room.discussion_turn_started_at);
        setDiscussionPausedAt(room.discussion_paused_at);
        setDiscussionTotalPausedSeconds(room.discussion_total_paused_seconds);
        setSniperPhase(room.sniper_revenge_phase);
        setSniperSniperId(room.sniper_revenge_sniper_id);
        setSniperStartedAt(room.sniper_revenge_started_at);
        setSniperVictimId(room.sniper_revenge_victim_id);
        setSniperResultStartedAt(room.sniper_revenge_result_started_at);
        setWinner(room.winner);

        const { data: sessionData } = await supabase.auth.getSession();
        const { data: myPlayerRow } = await supabase
          .from("players")
          .select("id, name, is_alive")
          .eq("room_id", room.id)
          .eq("auth_id", sessionData.session?.user.id)
          .maybeSingle();
        if (myPlayerRow) {
          setMyPlayerId(myPlayerRow.id);
          setMyName(myPlayerRow.name);
          setIsAlive(myPlayerRow.is_alive);
        }

        const { data: playersData } = await supabase
          .from("players")
          .select("id, name, is_alive")
          .eq("room_id", room.id)
          .eq("is_host", false);
        setRoomPlayers((playersData as { id: string; name: string; is_alive: boolean }[]) || []);

        const { data, error: rpcError } = await supabase.rpc("get_my_role", {
          p_room_id: room.id,
        });

        if (rpcError) {
          setError("تعذّر جلب دورك: " + rpcError.message);
          setLoading(false);
          return;
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          setError("لم يتم توزيع دور لك بعد.");
          setLoading(false);
          return;
        }

        setRole(row.role as RoleKey);
        setTeam(row.team as TeamKey);
      } catch (e: any) {
        setError(e.message || "حدث خطأ غير متوقع.");
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  function closeCurtainNow() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setCurtain(0);
    setRevealed((prev) => {
      if (prev) setSheenKey((k) => k + 1);
      return false;
    });
    setShowTeam(false);
  }

  // إخفاء فوري لما اللاعب يغادر الصفحة أو يفتح تطبيق ثاني
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) closeCurtainNow();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // نبضة حياة
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
    const interval = setInterval(ping, 20000);
    return () => clearInterval(interval);
  }, [myPlayerId]);

  // مراقبة إغلاق الغرفة لحظيًا — لو الحكم قفلها أثناء اللعبة، وضّح للاعب بدل ما تعلّق صفحته بصمت
  useEffect(() => {
    if (!roomId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`room-close-watch-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        () => {
          setError("أغلق الحكم هذه الغرفة. انتهت اللعبة.");
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // مراقبة حالة "حي/ميت" لحظيًا — لو الحكم أخرجك من اللعبة تظهر لك رسالة فورية
  useEffect(() => {
    if (!myPlayerId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`death-watch-${myPlayerId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "players",
          filter: `id=eq.${myPlayerId}`,
        },
        (payload) => {
          const alive = (payload.new as any)?.is_alive;
          if (typeof alive === "boolean") setIsAlive(alive);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myPlayerId]);

  // مراقبة حالة التصويت لحظيًا — تحوّل الشاشة لعرض التصويت فورًا لما الحكم يبدأه
  useEffect(() => {
    if (!roomId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`voting-watch-${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          const n = payload.new as any;
          if (typeof n.voting_phase === "string") setVotingPhase(n.voting_phase);
          if (Array.isArray(n.voting_order)) setVotingOrder(n.voting_order);
          if (typeof n.voting_index === "number") setVotingIndex(n.voting_index);
          if ("voting_turn_started_at" in n) setVotingTurnStartedAt(n.voting_turn_started_at);
          if ("voting_result_started_at" in n) setVotingResultStartedAt(n.voting_result_started_at);
          if ("voting_eliminated_player_id" in n)
            setVotingEliminatedPlayerId(n.voting_eliminated_player_id);
          if (typeof n.voting_tie === "boolean") setVotingTie(n.voting_tie);
          if (typeof n.round_number === "number") setRoundNumber(n.round_number);
          if (typeof n.discussion_phase === "string") setDiscussionPhase(n.discussion_phase);
          if (Array.isArray(n.discussion_order)) setDiscussionOrder(n.discussion_order);
          if (typeof n.discussion_index === "number") setDiscussionIndex(n.discussion_index);
          if ("discussion_turn_started_at" in n)
            setDiscussionTurnStartedAt(n.discussion_turn_started_at);
          if ("discussion_paused_at" in n) setDiscussionPausedAt(n.discussion_paused_at);
          if (typeof n.discussion_total_paused_seconds === "number")
            setDiscussionTotalPausedSeconds(n.discussion_total_paused_seconds);
          if (typeof n.sniper_revenge_phase === "string") {
            setSniperPhase(n.sniper_revenge_phase);
            if (n.sniper_revenge_phase === "choosing") {
              // نجيب حالة الأحياء الحالية بدقة لحظة بدء دور الانتقام
              supabase
                .from("players")
                .select("id, name, is_alive")
                .eq("room_id", roomId)
                .eq("is_host", false)
                .then(({ data }) => {
                  if (data) setRoomPlayers(data as { id: string; name: string; is_alive: boolean }[]);
                });
            }
          }
          if ("sniper_revenge_sniper_id" in n) setSniperSniperId(n.sniper_revenge_sniper_id);
          if ("sniper_revenge_started_at" in n) setSniperStartedAt(n.sniper_revenge_started_at);
          if ("sniper_revenge_victim_id" in n) setSniperVictimId(n.sniper_revenge_victim_id);
          if ("sniper_revenge_result_started_at" in n)
            setSniperResultStartedAt(n.sniper_revenge_result_started_at);
          if ("winner" in n) setWinner(n.winner);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  const onGripDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    dragging.current = true;
    const clientX = "clientX" in e ? e.clientX : e.touches?.[0]?.clientX ?? 0;
    startX.current = clientX;
    startCurtain.current = curtain;
  }, [curtain]);

  const onMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging.current || !cardRef.current) return;
    const clientX = "clientX" in e ? e.clientX : e.touches?.[0]?.clientX ?? 0;
    const width = cardRef.current.offsetWidth || 1;
    const distance = Math.abs(startX.current - clientX) / width;
    // إذا بدأنا السحب والبطاقة شبه مغلقة → السحب بأي اتجاه يفتحها أكثر
    // إذا بدأنا السحب والبطاقة شبه مفتوحة → السحب بأي اتجاه يقفلها (يرجعها)
    const opening = startCurtain.current < 0.5;
    const raw = opening
      ? startCurtain.current + distance
      : startCurtain.current - distance;
    setCurtain(Math.min(1, Math.max(0, raw)));
  }, []);

  const onUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setCurtain((c) => {
      const committedOpen = c >= 0.9;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setRevealed((prevRevealed) => {
        if (committedOpen !== prevRevealed) setSheenKey((k) => k + 1);
        return committedOpen;
      });
      if (committedOpen) {
        hideTimerRef.current = setTimeout(() => {
          closeCurtainNow();
        }, 3000);
      }
      return committedOpen ? 1 : 0;
    });
  }, []);

  async function loadTeam() {
    if (!roomId) return;
    setTeamLoading(true);
    setShowTeam(true);
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc("get_mafia_team", {
      p_room_id: roomId,
    });
    if (!error && data) setTeamMembers(data as TeamMember[]);
    setTeamLoading(false);
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

  if (error || !role) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-4"
        style={{ background: "#0B0E14" }}
      >
        <p className="text-sm text-center" style={{ color: "#E05A4A" }}>{error}</p>
        <button
          onClick={() => router.push(`/room/${code}`)}
          className="text-xs rounded-full px-4 py-2 border"
          style={{ color: "#C9A227", borderColor: "#C9A227" }}
        >
          رجوع للغرفة
        </button>
        <button
          onClick={() => router.push("/")}
          className="text-xs rounded-full px-4 py-2 border"
          style={{ color: "#C9A227", borderColor: "#C9A227" }}
        >
          🏠 الرجوع للصفحة الرئيسية
        </button>
      </main>
    );
  }

  if ((sniperPhase === "choosing" || sniperPhase === "result") && roomId) {
    return (
      <LocalSniperRevengeScreen
        roomCode={code}
        phase={sniperPhase as "choosing" | "result"}
        sniperId={sniperSniperId}
        startedAt={sniperStartedAt}
        victimId={sniperVictimId}
        resultStartedAt={sniperResultStartedAt}
        players={roomPlayers}
        myPlayerId={myPlayerId}
      />
    );
  }

  if (winner === "mafia" || winner === "civilians") {
    return <LocalGameOverScreen winner={winner} />;
  }

  if (!isAlive) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-3"
        style={{ background: "#0B0E14" }}
      >
        <div className="text-5xl mb-2">💀</div>
        <p className="text-2xl font-extrabold" style={{ color: "#E05A4A" }}>
          تم قتلك
        </p>
        <p className="text-xs text-center max-w-xs" style={{ color: "#8A93A6" }}>
          خرجت من اللعبة. تقدر تتفرج على الباقي، بس ما عاد عندك أي تأثير على مجرياتها.
        </p>
      </main>
    );
  }

  if ((votingPhase === "voting" || votingPhase === "result") && roomId) {
    return (
      <LocalVotingScreen
        roomId={roomId}
        roomCode={code}
        roundNumber={roundNumber}
        votingPhase={votingPhase as "voting" | "result"}
        votingOrder={votingOrder}
        votingIndex={votingIndex}
        votingTurnStartedAt={votingTurnStartedAt}
        votingResultStartedAt={votingResultStartedAt}
        eliminatedPlayerId={votingEliminatedPlayerId}
        tie={votingTie}
        players={roomPlayers}
        myPlayerId={myPlayerId}
      />
    );
  }

  if (discussionPhase !== "idle" && roomId) {
    return (
      <LocalDiscussionScreen
        roomId={roomId}
        roomCode={code}
        roundNumber={roundNumber}
        phase={discussionPhase as "a" | "b" | "c"}
        order={discussionOrder}
        index={discussionIndex}
        turnStartedAt={discussionTurnStartedAt}
        pausedAt={discussionPausedAt}
        totalPausedSeconds={discussionTotalPausedSeconds}
        players={roomPlayers}
        myPlayerId={myPlayerId}
        isHost={false}
      />
    );
  }

  const def = ROLES[role];
  const isMafiaTeam = team === "mafia";
  const curtainWidthPct = (1 - curtain) * 100;
  // توهّج الظل يشتغل فقط أثناء السحب الفعلي بمنتصف الحركة، ويهدأ قريبًا من الطرفين
  const isMidDrag = dragging.current && curtain > 0.08 && curtain < 0.92;

  return (
    <main
      className="min-h-screen flex flex-col select-none"
      style={{ background: "#0B0E14" }}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onTouchMove={onMove}
      onTouchEnd={onUp}
    >
      <div className="px-5 pt-8 pb-3 text-center">
        <div className="text-[11px] tracking-[0.3em] mb-1" style={{ color: "#8A93A6" }}>
          تم توزيع دورك
        </div>
        <div className="font-display text-2xl" style={{ color: "#EDEAE0" }}>بطاقتك</div>
        {myName && (
          <div className="text-sm mt-1" style={{ color: "#C9A227" }}>{myName}</div>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div
          ref={cardRef}
          className="relative w-60"
          style={{ aspectRatio: "3 / 4", touchAction: "none" }}
        >
          {/* ظل/توهج ديناميكي — يتعمّق ويتوهّج بذهبي خفيف بمنتصف السحب الفعلي بس (خارج القص عشان ما ينقصّ) */}
          <div
            className="absolute pointer-events-none"
            style={{
              inset: -6,
              borderRadius: 30,
              boxShadow: isMidDrag
                ? "0 30px 70px -8px rgba(0,0,0,0.9), 0 0 40px -6px rgba(201,162,39,0.25)"
                : "0 12px 40px -12px rgba(0,0,0,0.6)",
              transition: "box-shadow 0.62s cubic-bezier(.34,1.15,.35,1)",
            }}
          />

          <div
            className="absolute inset-0 rounded-3xl overflow-hidden"
            style={{ border: "1px solid #2A3342" }}
          >
            {/* محتوى الدور — صورة واحدة كاملة (مشهد + اسم الدور مدموجين) بلا استثناء، حتى لا تدل الألوان على الفريق */}
            <div className="absolute inset-0">
              <img
                src={`/roles/neutral/${role}.jpg`}
                alt={`أنت ${def.nameAr}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
              />
            </div>

            {/* الستارة — غطاء محايد بنمط زخرفي فني، يسحبه اللاعب ليكشف البطاقة تدريجيًا */}
            <div
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{
                width: `${curtainWidthPct}%`,
                background:
                  "radial-gradient(ellipse at 50% 40%, #141B26 0%, #0B0E14 75%)",
                transition: dragging.current ? "none" : "width 0.62s cubic-bezier(.34,1.15,.35,1)",
                borderLeft: curtainWidthPct > 0 && curtainWidthPct < 100 ? "1px solid #EDEAE022" : "none",
              }}
            >
              <CardBackArt />
            </div>

            {/* لمعة تمر عبر الوجه لحظة اكتمال أي كشف/إخفاء حقيقي — تُعاد بكل مرة عبر sheenKey */}
            <div key={sheenKey} className="sheen-sweep" />
          </div>

          {/* المقبض — العنصر الوحيد القابل للسحب، خفيف وغير لافت */}
          <div
            onMouseDown={onGripDown}
            onTouchStart={onGripDown}
            className="absolute top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10 no-select"
            style={{
              left: `clamp(14px, ${curtainWidthPct}%, calc(100% - 14px))`,
              transform: "translate(-50%, -50%)",
              transition: dragging.current ? "none" : "left 0.62s cubic-bezier(.34,1.15,.35,1)",
              touchAction: "none",
            }}
          >
            <div
              className="w-7 h-11 rounded-full flex items-center justify-center"
              style={{ background: "#EDEAE0", boxShadow: "0 2px 8px #00000088" }}
            >
              <span style={{ color: "#0B0E14", fontSize: 10 }}>⇔</span>
            </div>
          </div>
        </div>

        {revealed && (
          <p className="text-xs leading-relaxed max-w-xs text-center mt-3" style={{ color: "#8A93A6" }}>
            {def.shortDescAr}
          </p>
        )}

        <p className="text-[11px] mt-4 text-center max-w-xs" style={{ color: "#8A93A6" }}>
          {revealed
            ? "اسحب المقبض مرة ثانية لإخفاء دورك فورًا"
            : "اسحب المقبض بخفة لكشف دورك"}
        </p>

        {/* زر احتياطي يشتغل دايمًا — يضمن إخفاء البطاقة حتى لو تعطّل السحب لأي سبب */}
        <button
          onClick={closeCurtainNow}
          className="w-full max-w-xs rounded-full py-3 text-sm font-bold mt-4"
          style={{
            background: "transparent",
            border: "1px solid #2A3342",
            color: "#8A93A6",
          }}
        >
          إخفاء الكرت
        </button>

        {revealed && isMafiaTeam && !showTeam && (
          <button
            onClick={loadTeam}
            className="w-full max-w-xs rounded-full py-3 text-sm font-bold mt-2"
            style={{ background: "#EDEAE0", color: "#0B0E14" }}
          >
            أعضاء فريقك
          </button>
        )}

        {showTeam && (
          <div
            className="w-full max-w-xs mt-4 rounded-xl p-4"
            style={{ background: "#0B0E14", border: "1px solid #2A3342" }}
          >
            <div className="text-xs mb-2 font-bold" style={{ color: "#EDEAE0" }}>
              أعضاء فريقك
            </div>
            {teamLoading ? (
              <p className="text-xs" style={{ color: "#8A93A6" }}>جارٍ التحميل...</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {teamMembers.map((m) => (
                  <div
                    key={m.player_id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span style={{ color: "#EDEAE0" }}>{m.name}</span>
                    <span className="text-[11px]" style={{ color: "#8A93A6" }}>
                      {ROLES[m.role].nameAr}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
