import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import {
  resolveMafiaPhase,
  resolveDetectivePhase,
  resolveDoctorPhase,
} from "@/lib/onlineNightResolver";

const NIGHT_PHASE_SECONDS = 30;

const STARTED_AT_FIELD: Record<string, string> = {
  mafia_phase: "mafia_phase_started_at",
  detective_phase: "detective_phase_started_at",
  doctor_phase: "doctor_phase_started_at",
};

/**
 * يُستدعى من أي عميل لما ينتهي مؤقت الـ30 ثانية لمرحلة ليلية.
 * يتحقق السيرفر من الوقت فعليًا، وبعدها يفرض التقدّم حتى لو صاحب الدور ما أرسل فعله (انقطاع).
 */
export async function POST(req: Request) {
  try {
    await getAuthIdFromRequest(req);
    const { roomCode } = (await req.json()) as { roomCode: string };
    const admin = getSupabaseAdminClient();

    const { data: room, error } = await admin
      .from("online_rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (error || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }

    const field = STARTED_AT_FIELD[room.status];
    if (!field) {
      return NextResponse.json({ success: true }); // مو مرحلة ليلية، تجاهل بهدوء
    }

    const startedAtRaw = room[field];
    if (!startedAtRaw) {
      return NextResponse.json({ success: true });
    }
    const elapsedSeconds = (Date.now() - new Date(startedAtRaw).getTime()) / 1000;
    if (elapsedSeconds < NIGHT_PHASE_SECONDS - 0.5) {
      return NextResponse.json({ error: "لسا ما خلص وقت المرحلة." }, { status: 409 });
    }

    if (room.status === "mafia_phase") {
      await resolveMafiaPhase(admin, room); // يحسم بما وصل، أو عشوائيًا لو محد صوّت
    } else if (room.status === "detective_phase") {
      await resolveDetectivePhase(admin, room); // الشرطي ضيّع فرصته هذي الليلة
    } else if (room.status === "doctor_phase") {
      await resolveDoctorPhase(admin, room, null); // الطبيب ما حمى أحد
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
