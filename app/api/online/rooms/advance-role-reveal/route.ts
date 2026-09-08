import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

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
    if (room.status !== "role_reveal") {
      return NextResponse.json({ success: true });
    }

    const startedAt = new Date(room.role_reveal_started_at).getTime();
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds < 4.5) {
      return NextResponse.json({ error: "لسا ما خلصت 5 ثواني." }, { status: 409 });
    }

    await admin
      .from("online_rooms")
      .update({
        status: "mafia_recognition",
        mafia_recognition_started_at: new Date().toISOString(),
      })
      .eq("id", room.id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
