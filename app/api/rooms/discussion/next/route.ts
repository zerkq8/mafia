import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { advanceToNextDiscussionTurn } from "@/lib/localDiscussionResolver";
import { computeDiscussionRemaining, DiscussionPhase } from "@/lib/discussionTiming";

/**
 * مسارين بنفس الراوت:
 * 1) ضغطة صريحة على زر "التالي" (force:true) — من صاحب الدور نفسه أو الحكم، فورية بدون فحص وقت.
 * 2) نبض دوري تلقائي من أي عميل متصل (بدون force) — يتقدّم فقط لو الوقت خلص فعليًا،
 *    حتى لو المتصل نفسه هو صاحب الدور أو الحكم (يمنع أن يفرض النبض الدوري تقدّمًا مبكرًا بالغلط).
 */
export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode, force } = (await req.json()) as {
      roomCode: string;
      force?: boolean;
    };
    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }
    if (room.discussion_phase === "idle") {
      return NextResponse.json({ success: true }); // ما فيه نقاش جارٍ، تجاهل بهدوء
    }
    if (room.discussion_paused_at) {
      return NextResponse.json({ error: "الوقت متوقف الآن." }, { status: 409 });
    }

    const { data: me } = await admin
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();

    const order: string[] = room.discussion_order || [];
    const currentSpeakerId = order[room.discussion_index];
    const isSpeaker = !!me && me.id === currentSpeakerId;
    const isHost = room.host_auth_id === authId;

    // الفورية مسموحة فقط لصاحب الدور أو الحكم، وفقط لما تكون ضغطة صريحة (force)
    const allowImmediate = !!force && (isSpeaker || isHost);

    if (!allowImmediate) {
      const remaining = computeDiscussionRemaining({
        phase: room.discussion_phase as Exclude<DiscussionPhase, "idle">,
        turnStartedAt: room.discussion_turn_started_at,
        pausedAt: room.discussion_paused_at,
        totalPausedSeconds: room.discussion_total_paused_seconds,
      });
      if (remaining > 0.5) {
        return NextResponse.json({ error: "لسا ما خلص وقت الدور." }, { status: 409 });
      }
    }

    await advanceToNextDiscussionTurn(admin, room);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
