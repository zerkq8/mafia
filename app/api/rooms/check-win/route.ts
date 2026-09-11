import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { checkAndApplyWinCondition } from "@/lib/localWinCheck";

/**
 * يُستدعى بعد أي قتل يدوي من الحكم لا علاقة له بالقناص (أو بعد ما يتأكد
 * إن القناص المقتول لن يبدأ دور انتقام لأي سبب) — يفحص شروط الفوز فورًا.
 */
export async function POST(req: Request) {
  try {
    await getAuthIdFromRequest(req);
    const { roomCode } = (await req.json()) as { roomCode: string };
    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("id, round_number")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }

    await checkAndApplyWinCondition(admin, room.id, room.round_number);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
