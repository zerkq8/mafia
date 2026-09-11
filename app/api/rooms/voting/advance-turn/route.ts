import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { resolveLocalVote } from "@/lib/localVoteResolver";

const TURN_SECONDS = 12;

/**
 * يُستدعى من أي عميل متصل (كل اللاعبين + الحكم يسحّبونه بشكل دوري)
 * لما ينتهي وقت دور اللاعب الحالي بدون تصويت — يتحقق السيرفر من الوقت فعليًا،
 * وينقل الدور للاعب التالي بدون تسجيل صوت (تخطّي).
 */
export async function POST(req: Request) {
  try {
    await getAuthIdFromRequest(req);
    const { roomCode } = (await req.json()) as { roomCode: string };
    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }
    if (room.voting_phase !== "voting") {
      return NextResponse.json({ success: true }); // مو وقت تصويت، تجاهل بهدوء
    }
    if (!room.voting_turn_started_at) {
      return NextResponse.json({ success: true });
    }

    const elapsedSeconds =
      (Date.now() - new Date(room.voting_turn_started_at).getTime()) / 1000;
    if (elapsedSeconds < TURN_SECONDS - 0.5) {
      return NextResponse.json({ error: "لسا ما خلص وقت الدور." }, { status: 409 });
    }

    const order: string[] = room.voting_order || [];
    const currentIndex: number = room.voting_index;
    const nextIndex = currentIndex + 1;

    if (nextIndex >= order.length) {
      await resolveLocalVote(admin, room);
    } else {
      await admin
        .from("rooms")
        .update({ voting_index: nextIndex, voting_turn_started_at: new Date().toISOString() })
        .eq("id", room.id)
        .eq("voting_index", currentIndex);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
