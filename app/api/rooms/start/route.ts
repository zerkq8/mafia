import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { secureShuffle } from "@/lib/secureShuffle";
import { buildRoleDeck, calcCivilianCount, RoleCounts, RoleKey, ROLES } from "@/lib/roles";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
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
    if (room.host_auth_id !== authId) {
      return NextResponse.json(
        { error: "فقط الحكم يستطيع بدء اللعبة." },
        { status: 403 }
      );
    }
    if (room.status !== "lobby") {
      return NextResponse.json(
        { error: "اللعبة بدأت بالفعل." },
        { status: 409 }
      );
    }

    const { data: players, error: playersError } = await admin
      .from("players")
      .select("id, is_ready, is_host")
      .eq("room_id", room.id);
    if (playersError) throw playersError;

    const regularPlayers = (players || []).filter((p) => !p.is_host);

    if (regularPlayers.length !== room.target_player_count) {
      return NextResponse.json(
        { error: "عدد اللاعبين لا يطابق العدد المطلوب." },
        { status: 409 }
      );
    }
    if (!regularPlayers.every((p) => p.is_ready)) {
      return NextResponse.json(
        { error: "لا يمكن البدء قبل استعداد جميع اللاعبين." },
        { status: 409 }
      );
    }

    const { data: roleConfigRows, error: rcError } = await admin
      .from("role_configs")
      .select("role, count")
      .eq("room_id", room.id);
    if (rcError) throw rcError;

    const counts: RoleCounts = {
      mafia: 0,
      informer: 0,
      mafia_cop: 0,
      detective: 0,
      doctor: 0,
      sniper: 0,
    };
    (roleConfigRows || []).forEach((r) => {
      if (r.role in counts) {
        (counts as any)[r.role] = r.count;
      }
    });

    const civilianCount = calcCivilianCount(room.target_player_count, counts);
    if (civilianCount < 0) {
      return NextResponse.json(
        { error: "إعداد الأدوار غير صالح." },
        { status: 409 }
      );
    }

    const deck = secureShuffle(buildRoleDeck(counts, civilianCount));
    if (deck.length !== regularPlayers.length) {
      return NextResponse.json(
        { error: "عدم تطابق بين عدد الأدوار وعدد اللاعبين." },
        { status: 500 }
      );
    }

    const newRound = (room.round_number || 0) + 1;

    const assignments = regularPlayers.map((p, i) => {
      const role = deck[i] as RoleKey;
      return {
        room_id: room.id,
        player_id: p.id,
        role,
        team: ROLES[role].team,
        round_number: newRound,
      };
    });

    const { error: assignError } = await admin
      .from("role_assignments")
      .insert(assignments);
    if (assignError) throw assignError;

    const { error: updateError } = await admin
      .from("rooms")
      .update({
        status: "role_reveal",
        round_number: newRound,
        night_phase: "none",
      })
      .eq("id", room.id);
    if (updateError) throw updateError;

    await admin.from("game_events").insert({
      room_id: room.id,
      round_number: newRound,
      event_type: "game_started",
      payload: { player_count: regularPlayers.length },
      gm_only: false,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
