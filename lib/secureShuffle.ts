import "server-only";
import { randomInt } from "crypto";

/**
 * Fisher-Yates shuffle باستخدام crypto.randomInt (آمن، غير قابل للتنبؤ).
 * يُستخدم حصرًا على السيرفر عند توزيع الأدوار.
 */
export function secureShuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون أحرف/أرقام ملتبسة
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[randomInt(0, chars.length)];
  }
  return code;
}
