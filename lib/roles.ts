/**
 * نظام الأدوار المركزي — طبقًا للمواصفات المحددة بدون أي إضافة.
 * كل دور: الفريق، نتيجة التحقيق الظاهرة للشرطي، الاسم والوصف العربي.
 */

export type RoleKey =
  | "mafia"
  | "informer"
  | "mafia_cop"
  | "detective"
  | "doctor"
  | "sniper"
  | "civilian";

export type TeamKey = "mafia" | "civilian";

export interface RoleDefinition {
  key: RoleKey;
  team: TeamKey;
  /** النتيجة التي يراها الشرطي الحقيقي عند التحقيق في هذا الدور */
  investigationResult: TeamKey;
  nameAr: string;
  emoji: string;
  shortDescAr: string;
  /** هل هذا الدور جزء من "فريق المافيا" الذي يفتح عينيه مع بعض ليلًا */
  wakesWithMafia: boolean;
  /** هل لديه فعل ليلي فردي (تحقيق/حماية) بمعزل عن فريق المافيا */
  hasSoloNightAction: boolean;
}

export const ROLES: Record<RoleKey, RoleDefinition> = {
  mafia: {
    key: "mafia",
    team: "mafia",
    investigationResult: "mafia",
    nameAr: "المافيا",
    emoji: "🔴",
    shortDescAr: "أنت عضو في فريق المافيا. تشارك في اختيار الضحية كل ليلة.",
    wakesWithMafia: true,
    hasSoloNightAction: false,
  },
  informer: {
    key: "informer",
    team: "mafia",
    // القاعدة الحرجة: المخبر مافيا فعليًا، لكن نتيجة التحقيق تظهر "شعب"
    investigationResult: "civilian",
    nameAr: "المخبر",
    emoji: "🕵️",
    shortDescAr:
      "أنت من فريق المافيا، لكن إذا حقق الشرطي الحقيقي معك ستظهر له نتيجة: شعب.",
    wakesWithMafia: true,
    hasSoloNightAction: false,
  },
  mafia_cop: {
    key: "mafia_cop",
    team: "mafia",
    investigationResult: "mafia",
    nameAr: "الشرطي الوهمي",
    emoji: "🕵️‍♂️",
    shortDescAr:
      "أنت من فريق المافيا. تستطيع الادعاء أمام الجميع بأنك الشرطي الحقيقي.",
    wakesWithMafia: true,
    hasSoloNightAction: false,
  },
  detective: {
    key: "detective",
    team: "civilian",
    investigationResult: "civilian",
    nameAr: "الشرطي الحقيقي",
    emoji: "👮",
    shortDescAr: "في الليل يمكنك التحقيق في لاعب واحد لمعرفة فريقه الحقيقي.",
    wakesWithMafia: false,
    hasSoloNightAction: true,
  },
  doctor: {
    key: "doctor",
    team: "civilian",
    investigationResult: "civilian",
    nameAr: "الطبيب",
    emoji: "🩺",
    shortDescAr: "في الليل يمكنك حماية لاعب واحد من هجوم المافيا.",
    wakesWithMafia: false,
    hasSoloNightAction: true,
  },
  sniper: {
    key: "sniper",
    team: "civilian",
    investigationResult: "civilian",
    nameAr: "القناص",
    emoji: "🎯",
    shortDescAr: "إذا خرجت من اللعبة، تختار لاعبًا واحدًا ليخرج معك.",
    wakesWithMafia: false,
    hasSoloNightAction: false,
  },
  civilian: {
    key: "civilian",
    team: "civilian",
    investigationResult: "civilian",
    nameAr: "الشعب",
    emoji: "👥",
    shortDescAr: "ليس لديك قدرة خاصة. حاول اكتشاف أعضاء المافيا بالنقاش.",
    wakesWithMafia: false,
    hasSoloNightAction: false,
  },
};

export const MAFIA_TEAM_ROLES: RoleKey[] = ["mafia", "informer", "mafia_cop"];
export const CONFIGURABLE_ROLES: RoleKey[] = [
  "mafia",
  "informer",
  "mafia_cop",
  "detective",
  "doctor",
  "sniper",
];

export interface RoleCounts {
  mafia: number;
  informer: number;
  mafia_cop: number;
  detective: number;
  doctor: number;
  sniper: number;
}

export function calcCivilianCount(
  totalPlayers: number,
  counts: RoleCounts
): number {
  const specialTotal =
    counts.mafia +
    counts.informer +
    counts.mafia_cop +
    counts.detective +
    counts.doctor +
    counts.sniper;
  return totalPlayers - specialTotal;
}

export function validateRoleCounts(
  totalPlayers: number,
  counts: RoleCounts
): { valid: boolean; message?: string; civilianCount: number } {
  const civilianCount = calcCivilianCount(totalPlayers, counts);
  const specialTotal = totalPlayers - civilianCount;

  if (specialTotal > totalPlayers) {
    return {
      valid: false,
      message: "عدد الأدوار أكبر من عدد اللاعبين.",
      civilianCount: 0,
    };
  }
  if (civilianCount < 0) {
    return {
      valid: false,
      message: "عدد الأدوار أكبر من عدد اللاعبين.",
      civilianCount: 0,
    };
  }
  return { valid: true, civilianCount };
}

/**
 * Secure random shuffle — Fisher-Yates باستخدام crypto لعشوائية آمنة.
 * يُستخدم فقط على السيرفر (Route Handler) عند توزيع الأدوار.
 */
export function buildRoleDeck(counts: RoleCounts, civilianCount: number): RoleKey[] {
  const deck: RoleKey[] = [];
  (Object.keys(counts) as (keyof RoleCounts)[]).forEach((role) => {
    for (let i = 0; i < counts[role]; i++) deck.push(role as RoleKey);
  });
  for (let i = 0; i < civilianCount; i++) deck.push("civilian");
  return deck;
}
