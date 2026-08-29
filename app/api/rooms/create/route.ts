import { NextResponse } from "next/server";
import { getSupabaseAdminClient, getAuthIdFromRequest } from "@/lib/supabase/admin";
import { generateRoomCode } from "@/lib/secureShuffle";
import { validateRoleCounts, CONFIGURABLE_ROLES, RoleCounts } from "@/lib/roles";

export async function POST(req: Request) {
  try {
    const authId = await getAuthIdFromRequest(req);
    const body = await req.json();
    const { hostName, targetPlayerCount, roleCounts } = body as {
      hostName: string;
      targetPlayerCount: number;
      roleCounts: RoleCounts;
    };

    if (!hostName || hostName.trim().length < 2 || hostName.trim().length > 20) {
      return NextResponse.json(
        { error: "اسم اللاعب يجب أن يكون بين 2 و20 حرفًا." },
        { status: 400 }
      );
    }
    if (
      !Number.isInteger(targetPlayerCount) ||
      targetPlayerCount < 10 ||
      targetPlayerCount > 30
    ) {
      return NextResponse.json(
        { error: "عدد اللاعبين يجب أن يكون بين 10 و30." },
        { status: 400 }
      );
    }

    const counts: RoleCounts = {
      mafia: Number(roleCounts?.mafia) || 0,
      informer: Number(roleCounts?.informer) || 0,
      mafia_cop: Number(roleCounts?.mafia_cop) || 0,
      detective: Number(roleCounts?.detective) || 0,
      doctor: Number(roleCounts?.doctor) || 0,
      sniper: Number(roleCounts?.sniper) || 0,
    };

    const validation = validateRoleCounts(targetPlayerCount, counts);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.message }, { status: 400 });
    }

    const cleanName = hostName
      .replace(/<[^>]*>/g, "")
      .replace(/[<>"'`]/g, "")
      .trim();

    const admin = getSupabaseAdminClient();
    let code = generateRoomCode();

    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await admin
        .from("rooms")
        .select("id")
        .eq("code", code)
        .maybeSingle();
      if (!existing) break;
      code = generateRoomCode();
    }

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .insert({
        code,
        host_auth_id: authId,
        target_player_count: targetPlayerCount,
        status: "lobby",
      })
      .select()
      .single();

    if (roomError) throw roomError;

    const { error: hostError } = await admin.from("players").insert({
      room_id: room.id,
      auth_id: authId,
      name: cleanName,
      is_host: true,
      is_ready: true,
    });
    if (hostError) throw hostError;

    const roleConfigRows = CONFIGURABLE_ROLES.map((role) => ({
      room_id: room.id,
      role,
      count: counts[role as keyof RoleCounts],
    }));
    const { error: rolesError } = await admin
      .from("role_configs")
      .insert(roleConfigRows);
    if (rolesError) throw rolesError;

    return NextResponse.json({ room });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
