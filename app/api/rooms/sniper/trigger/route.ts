import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { maybeTriggerSniperRevenge } from "@/lib/sniperRevenge";

/**
 * يُستدعى من لوحة الحكم بعد أي قتل يدوي (إخراج من اللعبة) — يتحقق هل المقتول
 * قناص، وإذا كان كذا يبدأ دور الانتقام. بلا أثر إذا لم يكن قناصًا.
 */
export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode, killedPlayerId } = (await req.json()) as {
      roomCode: string;
      killedPlayerId: string;
    };
    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("id, round_number, host_auth_id")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }
    if (room.host_auth_id !== authId) {
      return NextResponse.json({ error: "فقط الحكم يقدر يشغّل هذا." }, { status: 403 });
    }

    const triggered = await maybeTriggerSniperRevenge(
      admin,
      room.id,
      room.round_number,
      killedPlayerId
    );

    return NextResponse.json({ success: true, triggered });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
