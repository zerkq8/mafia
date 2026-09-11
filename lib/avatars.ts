export const AVATAR_COUNT = 15;

/** رابط صورة الأفاتار حسب رقمها (1..15) — null لو الرقم غير صالح أو مفقود */
export function avatarUrl(index: number | null | undefined): string | null {
  if (!index || !Number.isInteger(index) || index < 1 || index > AVATAR_COUNT) return null;
  return `/avatars/set2/avatar-${index}.png`;
}
