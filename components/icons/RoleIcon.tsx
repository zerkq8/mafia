import React from "react";
import { RoleKey } from "@/lib/roles";

interface RoleIconProps {
  role: RoleKey;
  color?: string;
  size?: number;
  className?: string;
}

/** الشكل الموحّد (شارة/درع) لكل الأدوار — نفس الإطار الخارجي بالضبط، يختلف الرمز الداخلي بس */
function ShieldFrame({
  color,
  size,
  children,
}: {
  color: string;
  size: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M24 4L40 10V22C40 32 33 40 24 44C15 40 8 32 8 22V10L24 4Z"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
        fill="none"
      />
      {children}
    </svg>
  );
}

export function NeutralPersonIcon({
  color = "#8A93A6",
  size = 24,
  className,
}: {
  color?: string;
  size?: number;
  className?: string;
}) {
  return (
    <ShieldFrame color={color} size={size}>
      {/* شكل واحد محايد للجميع — بدون أي رمز يميّز دورًا عن آخر */}
      <circle cx="24" cy="24" r="3" fill={color} />
    </ShieldFrame>
  );
}

export default function RoleIcon({
  role,
  color = "#EDEAE0",
  size = 40,
  className,
}: RoleIconProps) {
  const inner = (() => {
    switch (role) {
      case "mafia":
        // خنجرين متقاطعين
        return (
          <g stroke={color} strokeWidth="1.8" strokeLinecap="round">
            <line x1="17" y1="17" x2="31" y2="31" />
            <line x1="31" y1="17" x2="17" y2="31" />
            <circle cx="17" cy="17" r="1.6" fill={color} stroke="none" />
            <circle cx="31" cy="17" r="1.6" fill={color} stroke="none" />
          </g>
        );
      case "informer":
        // عدسة مكبّرة (اكتشاف/تجسس)
        return (
          <g stroke={color} strokeWidth="1.8" strokeLinecap="round" fill="none">
            <circle cx="21" cy="21" r="7" />
            <line x1="26" y1="26" x2="32" y2="32" />
          </g>
        );
      case "mafia_cop":
        // نجمة شرطة فيها تصدّع خفيف يدل على الزيف
        return (
          <g stroke={color} strokeWidth="1.6" strokeLinejoin="round" fill="none">
            <path d="M24 14L26.5 20.5L33 21L28 25.5L29.5 32L24 28.5L18.5 32L20 25.5L15 21L21.5 20.5L24 14Z" />
            <line
              x1="24"
              y1="17"
              x2="22"
              y2="23"
              stroke={color}
              strokeWidth="1.2"
              opacity="0.7"
            />
          </g>
        );
      case "detective":
        // نجمة شرطة نظيفة متماسكة
        return (
          <path
            d="M24 14L26.5 20.5L33 21L28 25.5L29.5 32L24 28.5L18.5 32L20 25.5L15 21L21.5 20.5L24 14Z"
            stroke={color}
            strokeWidth="1.8"
            strokeLinejoin="round"
            fill="none"
          />
        );
      case "doctor":
        // صليب طبي
        return (
          <g stroke={color} strokeWidth="2" strokeLinecap="round">
            <line x1="24" y1="16" x2="24" y2="30" />
            <line x1="17" y1="23" x2="31" y2="23" />
          </g>
        );
      case "sniper":
        // دائرة تصويب
        return (
          <g stroke={color} strokeWidth="1.6" fill="none">
            <circle cx="24" cy="23" r="7" />
            <circle cx="24" cy="23" r="1.4" fill={color} stroke="none" />
            <line x1="24" y1="13" x2="24" y2="17" strokeWidth="1.6" />
            <line x1="24" y1="29" x2="24" y2="33" strokeWidth="1.6" />
            <line x1="14" y1="23" x2="18" y2="23" strokeWidth="1.6" />
            <line x1="30" y1="23" x2="34" y2="23" strokeWidth="1.6" />
          </g>
        );
      case "civilian":
      default:
        // شخصان متداخلان
        return (
          <g stroke={color} strokeWidth="1.6" fill="none">
            <circle cx="20" cy="19" r="4" />
            <path d="M13 30c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
            <circle cx="28" cy="19" r="4" opacity="0.6" />
            <path d="M21 30c0-4 3-6.5 7-6.5s7 2.5 7 6.5" opacity="0.6" />
          </g>
        );
    }
  })();

  return (
    <ShieldFrame color={color} size={size}>
      {inner}
    </ShieldFrame>
  );
}
