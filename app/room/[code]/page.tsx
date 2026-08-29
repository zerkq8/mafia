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

  const [drag, setDrag] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);
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

  // إخفاء فوري لما اللاعب يغادر الصفحة أو يفتح تطبيق ثاني (قسم 94-95 بالمواصفات)
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) {
        setRevealed(false);
        setDrag(0);
        setShowTeam(false);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const onDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (revealed) return;
      dragging.current = true;
      const clientX =
        "clientX" in e ? e.clientX : e.touches?.[0]?.clientX ?? 0;
      startX.current = clientX;
    },
    [revealed]
  );

  const onMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging.current || !trackRef.current) return;
    const clientX = "clientX" in e ? e.clientX : e.touches?.[0]?.clientX ?? 0;
    const width = trackRef.current.offsetWidth || 1;
    const delta = Math.abs(clientX - startX.current);
    const pct = Math.min(1, delta / (width - 40));
    setDrag(pct);
  }, []);

  const onUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (drag >= 0.98) {
      setRevealed(true);
      setDrag(1);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setRevealed(false);
        setDrag(0);
      }, 3000);
    } else {
      setDrag(0);
    }
  }, [drag]);

  function hideNow() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setRevealed(false);
    setDrag(0);
    setShowTeam(false);
  }

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
  const roleColor = isMafiaTeam ? "#8B2635" : "#2F6F62";

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
          className="w-full max-w-xs aspect-[3/4] rounded-2xl overflow-hidden relative flex items-center justify-center"
          style={{
            background: revealed
              ? `linear-gradient(160deg, ${roleColor}22, #141B26 70%)`
              : "linear-gradient(160deg, #1A2230, #0F141C)",
            border: `1px solid ${revealed ? roleColor + "55" : "#2A3342"}`,
            transition: "background 0.4s ease, border-color 0.4s ease",
          }}
        >
          {!revealed && (
            <div className="flex flex-col items-center gap-3 opacity-90">
              <div className="text-6xl">🎴</div>
              <div className="text-xs text-muted">اسحب الشريط بالأسفل للكشف</div>
            </div>
          )}
          {revealed && (
            <div
              className="flex flex-col items-center gap-3 px-6 text-center"
              style={{
                opacity: drag,
                transform: `scale(${0.85 + drag * 0.15})`,
                transition: "opacity 0.3s, transform 0.3s",
              }}
            >
              <div className="text-6xl">{def.emoji}</div>
              <div className="text-xl font-extrabold text-cream">
                أنت {def.nameAr}
              </div>
              <div className="text-xs leading-relaxed" style={{ color: "#B8BFCC" }}>
                {def.shortDescAr}
              </div>
            </div>
          )}
        </div>

        {!revealed ? (
          <div
            ref={trackRef}
            className="relative w-full max-w-xs h-12 mt-6 rounded-full"
            style={{ background: "#141B26", border: "1px solid #2A3342" }}
          >
            <div
              className="absolute inset-y-0 right-0 rounded-full"
              style={{
                width: `${drag * 100}%`,
                background: "linear-gradient(90deg, transparent, #C9A22766)",
              }}
            />
            <div
              onMouseDown={onDown}
              onTouchStart={onDown}
              className="absolute top-1 h-10 w-10 rounded-full grid place-items-center cursor-grab active:cursor-grabbing"
              style={{
                right: `calc(${drag * 100}% * 0.86)`,
                background: "#C9A227",
                transition: dragging.current ? "none" : "right 0.2s ease",
              }}
            >
              <span style={{ color: "#0B0E14", fontSize: 14 }}>⇠</span>
            </div>
            <div className="absolute inset-0 grid place-items-center text-[11px] text-muted pointer-events-none">
              اسحب للكشف
            </div>
          </div>
        ) : (
          <div className="w-full max-w-xs flex flex-col gap-2 mt-6">
            {isMafiaTeam && !showTeam && (
              <button
                onClick={loadTeam}
                className="w-full rounded-full py-3 text-sm font-bold"
                style={{ background: "#8B2635", color: "#EDEAE0" }}
              >
                🔴 أعضاء فريقك
              </button>
            )}
            <button
              onClick={hideNow}
              className="w-full rounded-full py-3 text-sm font-bold"
              style={{
                background: "transparent",
                border: "1px solid #2A3342",
                color: "#8A93A6",
              }}
            >
              إخفاء
            </button>
          </div>
        )}

        {showTeam && (
          <div
            className="w-full max-w-xs mt-4 rounded-xl p-4"
            style={{ background: "#1E1215", border: "1px solid #8B263555" }}
          >
            <div className="text-xs text-mafia mb-2 font-bold">
              🔴 أعضاء فريقك
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
                    <span className="text-cream">{m.name}</span>
                    <span className="text-[11px] text-muted">
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
