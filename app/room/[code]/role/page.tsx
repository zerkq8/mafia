"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ensureAnonymousSession,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";
import { ROLES, RoleKey, TeamKey } from "@/lib/roles";
import RoleIcon from "@/components/icons/RoleIcon";

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
  const [isAlive, setIsAlive] = useState(true);
  const [role, setRole] = useState<RoleKey | null>(null);
  const [team, setTeam] = useState<TeamKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 0 = الستارة مغلقة تمامًا (الدور مخفي)، 1 = مفتوحة تمامًا (الدور ظاهر)
  const [curtain, setCurtain] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startCurtain = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showTeam, setShowTeam] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await ensureAnonymousSession();
        const supabase = getSupabaseBrowserClient();

        const { data: room, error: roomError } = await supabase
          .from("rooms")
          .select("id")
          .eq("code", code)
          .maybeSingle();

        if (roomError || !room) {
          setError("لم يتم العثور على الغرفة.");
          setLoading(false);
          return;
        }
        setRoomId(room.id);

        const { data: sessionData } = await supabase.auth.getSession();
        const { data: myPlayerRow } = await supabase
          .from("players")
          .select("id, is_alive")
          .eq("room_id", room.id)
          .eq("auth_id", sessionData.session?.user.id)
          .maybeSingle();
        if (myPlayerRow) {
          setMyPlayerId(myPlayerRow.id);
          setIsAlive(myPlayerRow.is_alive);
        }

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
    setRevealed(false);
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
      if (c >= 0.9) {
        setRevealed(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          closeCurtainNow();
        }, 3000);
        return 1;
      }
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setRevealed(false);
      return 0;
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
      <main className="min-h-screen flex items-center justify-center text-muted text-sm">
        جارٍ التحميل...
      </main>
    );
  }

  if (error || !role) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-4">
        <p className="text-mafia text-sm text-center">{error}</p>
        <button
          onClick={() => router.push(`/room/${code}`)}
          className="text-xs text-gold border border-gold rounded-full px-4 py-2"
        >
          رجوع للغرفة
        </button>
      </main>
    );
  }

  if (!isAlive) {
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
          خرجت من اللعبة. تقدر تتفرج على الباقي، بس ما عاد عندك أي تأثير على مجرياتها.
        </p>
      </main>
    );
  }

  const def = ROLES[role];
  const isMafiaTeam = team === "mafia";
  const curtainWidthPct = (1 - curtain) * 100;

  return (
    <main
      className="min-h-screen flex flex-col select-none"
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onTouchMove={onMove}
      onTouchEnd={onUp}
    >
      <div className="px-5 pt-8 pb-3 text-center">
        <div className="text-[10px] tracking-[0.3em] text-muted mb-1">
          تم توزيع دورك
        </div>
        <div className="font-display text-2xl text-cream">بطاقتك</div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div
          ref={cardRef}
          className="relative w-60 rounded-3xl overflow-hidden"
          style={{
            border: "1px solid #2E2E2E",
            aspectRatio: "3 / 4",
            boxShadow: "0 12px 40px -12px rgba(0,0,0,0.6)",
            touchAction: "none",
          }}
        >
          {/* محتوى الدور — أبيض/أسود بحت لكل الأدوار بلا استثناء، حتى لا تدل الألوان على الفريق */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              background:
                "radial-gradient(ellipse at 50% 30%, #1C1C1C 0%, #0A0A0A 70%)",
            }}
          >
            <div className="flex flex-col items-center gap-3 px-5 text-center">
              <img
                src={`/roles/neutral/${role}.png`}
                alt=""
                width={64}
                height={64}
                style={{ objectFit: "contain" }}
              />
              <div className="text-lg font-extrabold" style={{ color: "#FFFFFF" }}>
                أنت {def.nameAr}
              </div>
              <div className="text-xs leading-relaxed max-w-[11rem]" style={{ color: "#AAAAAA" }}>
                {def.shortDescAr}
              </div>
            </div>
          </div>

          {/* الستارة — غطاء محايد بنمط زخرفي فني، يسحبه اللاعب ليكشف البطاقة تدريجيًا */}
          <div
            className="absolute inset-y-0 left-0 overflow-hidden"
            style={{
              width: `${curtainWidthPct}%`,
              background:
                "radial-gradient(ellipse at 50% 40%, #1A1A1A 0%, #050505 75%)",
              transition: dragging.current ? "none" : "width 0.25s ease",
              borderLeft: curtainWidthPct > 0 && curtainWidthPct < 100 ? "1px solid #FFFFFF22" : "none",
            }}
          >
            <CardBackArt />
          </div>

          {/* المقبض — العنصر الوحيد القابل للسحب، خفيف وغير لافت */}
          <div
            onMouseDown={onGripDown}
            onTouchStart={onGripDown}
            className="absolute top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10 no-select"
            style={{
              left: `clamp(14px, ${curtainWidthPct}%, calc(100% - 14px))`,
              transform: "translate(-50%, -50%)",
              transition: dragging.current ? "none" : "left 0.25s ease",
              touchAction: "none",
            }}
          >
            <div
              className="w-7 h-11 rounded-full flex items-center justify-center"
              style={{ background: "#FFFFFF", boxShadow: "0 2px 8px #00000088" }}
            >
              <span style={{ color: "#000000", fontSize: 10 }}>⇔</span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted mt-4 text-center max-w-xs">
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
            border: "1px solid #333333",
            color: "#AAAAAA",
          }}
        >
          إخفاء الكرت
        </button>

        {revealed && isMafiaTeam && !showTeam && (
          <button
            onClick={loadTeam}
            className="w-full max-w-xs rounded-full py-3 text-sm font-bold mt-2"
            style={{ background: "#FFFFFF", color: "#000000" }}
          >
            أعضاء فريقك
          </button>
        )}

        {showTeam && (
          <div
            className="w-full max-w-xs mt-4 rounded-xl p-4"
            style={{ background: "#0A0A0A", border: "1px solid #333333" }}
          >
            <div className="text-xs mb-2 font-bold" style={{ color: "#FFFFFF" }}>
              أعضاء فريقك
            </div>
            {teamLoading ? (
              <p className="text-xs text-muted">جارٍ التحميل...</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {teamMembers.map((m) => (
                  <div
                    key={m.player_id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span style={{ color: "#FFFFFF" }}>{m.name}</span>
                    <span className="text-[11px]" style={{ color: "#888888" }}>
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
