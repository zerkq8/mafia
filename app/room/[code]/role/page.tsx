"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ensureAnonymousSession,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";
import { ROLES, RoleKey, TeamKey } from "@/lib/roles";

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
    // السحب لليسار أو لليمين كلاهما يفتح الستارة أكثر
    const delta = (startX.current - clientX) / width;
    const next = Math.min(1, Math.max(0, startCurtain.current + Math.abs(delta) * (delta === 0 ? 0 : 1)));
    // نسمح بالسحب لأي اتجاه: نستخدم القيمة المطلقة للفارق
    const raw = startCurtain.current + Math.abs(startX.current - clientX) / width;
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
          className="relative w-32 rounded-2xl overflow-hidden"
          style={{ border: "1px solid #333333", aspectRatio: "3 / 4" }}
        >
          {/* محتوى الدور — أبيض/أسود بحت لكل الأدوار بلا استثناء، حتى لا تدل الألوان على الفريق */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "#0A0A0A" }}
          >
            <div className="flex flex-col items-center gap-2 px-3 text-center">
              <div className="text-3xl grayscale">{def.emoji}</div>
              <div className="text-sm font-extrabold" style={{ color: "#FFFFFF" }}>
                أنت {def.nameAr}
              </div>
              <div className="text-[10px] leading-relaxed" style={{ color: "#AAAAAA" }}>
                {def.shortDescAr}
              </div>
            </div>
          </div>

          {/* الستارة — غطاء محايد يسحبه اللاعب ليكشف البطاقة تدريجيًا */}
          <div
            className="absolute inset-y-0 left-0 flex items-center justify-center"
            style={{
              width: `${curtainWidthPct}%`,
              background: "#000000",
              transition: dragging.current ? "none" : "width 0.25s ease",
              borderLeft: curtainWidthPct > 0 && curtainWidthPct < 100 ? "1px solid #FFFFFF33" : "none",
            }}
          >
            {curtainWidthPct > 15 && (
              <div className="flex flex-col items-center gap-2 opacity-60">
                <div className="text-2xl grayscale">🎴</div>
              </div>
            )}
          </div>

          {/* المقبض — العنصر الوحيد القابل للسحب، خفيف وغير لافت */}
          <div
            onMouseDown={onGripDown}
            onTouchStart={onGripDown}
            className="absolute top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10"
            style={{
              left: `clamp(14px, ${curtainWidthPct}%, calc(100% - 14px))`,
              transform: "translate(-50%, -50%)",
              transition: dragging.current ? "none" : "left 0.25s ease",
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

        {revealed && (
          <div className="w-full max-w-xs flex flex-col gap-2 mt-4">
            {isMafiaTeam && !showTeam && (
              <button
                onClick={loadTeam}
                className="w-full rounded-full py-3 text-sm font-bold"
                style={{ background: "#FFFFFF", color: "#000000" }}
              >
                أعضاء فريقك
              </button>
            )}
            <button
              onClick={closeCurtainNow}
              className="w-full rounded-full py-3 text-sm font-bold"
              style={{
                background: "transparent",
                border: "1px solid #333333",
                color: "#AAAAAA",
              }}
            >
              إخفاء الآن
            </button>
          </div>
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
