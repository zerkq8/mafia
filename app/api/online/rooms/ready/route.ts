import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { secureShuffle } from "@/lib/secureShuffle";

const FIXED_DECK: ("mafia" | "doctor" | "detective" | "civilian")[] = [
  "mafia",
  "mafia",
  "doctor",
  "detective",
  "civilian",
  "civilian",
  "civilian",
  "civilian",
];

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const { roomCode } = (await req.json()) as { roomCode: string };
    const admin = getSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("online_rooms")
      .select("*")
      .eq("code", (roomCode || "").toUpperCase().trim())
      .maybeSingle();
    if (roomError || !room) {
      return NextResponse.json({ error: "الغرفة غير موجودة." }, { status: 404 });
    }

    const { data: me, error: meError } = await admin
      .from("online_players")
      .select("*")
      .eq("room_id", room.id)
      .eq("auth_id", authId)
      .maybeSingle();
    if (meError || !me) {
      return NextResponse.json({ error: "أنت مو عضو بهذي الغرفة." }, { status: 403 });
    }

    // اقلب حالة الاستعداد (المستمعون دايمًا "مستعدون"، ما ينطبق عليهم هذا الفعل عمليًا)
    if (!me.is_spectator) {
      const { error: updateError } = await admin
        .from("online_players")
        .update({ is_ready: !me.is_ready })
        .eq("id", me.id);
      if (updateError) throw updateError;
    }

    // تحقق: هل اكتمل عدد اللاعبين الفعليين (بدون المستمعين) والكل مستعد؟
    const { data: allPlayers, error: allError } = await admin
      .from("online_players")
      .select("id, is_ready, is_spectator")
      .eq("room_id", room.id);
    if (allError) throw allError;

    const activePlayers = allPlayers.filter((p) => !p.is_spectator);

    if (
      room.status === "waiting" &&
      activePlayers.length === 8 &&
      activePlayers.every((p) => p.is_ready)
    ) {
      // وزّع الأدوار عشوائيًا
      const shuffledRoles = secureShuffle(FIXED_DECK);
      const shuffledPlayers = secureShuffle(activePlayers.map((p) => p.id));

      const assignments = shuffledPlayers.map((playerId, i) => ({
        room_id: room.id,
        player_id: playerId,
        role: shuffledRoles[i],
      }));
      const { error: assignError } = await admin
        .from("online_role_assignments")
        .insert(assignments);
      if (assignError) throw assignError;

      // رتّب المقاعد عشوائيًا — 4 يمين و4 يسار، برقم مقعد 1-8
      const seatOrder = secureShuffle(shuffledPlayers);
      for (let i = 0; i < seatOrder.length; i++) {
        await admin
          .from("online_players")
          .update({
            seat_number: i + 1,
            seat_side: i < 4 ? "right" : "left",
          })
          .eq("id", seatOrder[i]);
      }

      await admin
        .from("online_rooms")
        .update({
          status: "role_reveal",
          round_number: 1,
          pending_mafia_target_id: null,
          last_death_player_id: null,
          role_reveal_started_at: new Date().toISOString(),
        })
        .eq("id", room.id);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
