import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode, targetPlayerId, action } = (await req.json()) as {
      roomCode: string;
      targetPlayerId: string;
      action: "kick" | "spectator";
    };

    const admin = getSupabaseAdminClient();
    const { data: room, error: roomError } = await admin
      .from("online_rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }

    if (room.created_by_auth_id !== authId) {
      return NextResponse.json(
        { error: "فقط منشئ الغرفة يقدر يسوي هذا." },
        { status: 403 }
      );
    }
    if (room.status !== "waiting") {
      return NextResponse.json(
        { error: "هذي الصلاحية تشتغل بس بغرفة الانتظار." },
        { status: 409 }
      );
    }

    if (action === "kick") {
      const { error: delError } = await admin
        .from("online_players")
        .delete()
        .eq("id", targetPlayerId)
        .eq("room_id", room.id);
      if (delError) throw delError;
    } else if (action === "spectator") {
      const { error: updateError } = await admin
        .from("online_players")
        .update({ is_spectator: true, is_ready: true })
        .eq("id", targetPlayerId)
        .eq("room_id", room.id);
      if (updateError) throw updateError;
    } else {
      return NextResponse.json({ error: "عملية غير معروفة." }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
