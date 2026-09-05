import { RoleKey } from "@/lib/roles";

interface RoleIconProps {
  role: RoleKey;
  color?: string;
  size?: number;
  className?: string;
}

/** إطار درع موحّد لكل الأدوار — الفرق فقط بالرمز الداخلي، أبدًا باللون. */
const SHIELD_PATH =
  "M12 2.5 L19.5 5.5 V11.2 C19.5 16.3 16.4 20.2 12 21.7 C7.6 20.2 4.5 16.3 4.5 11.2 V5.5 Z";

function InnerGlyph({ role, color }: { role: RoleKey; color: string }) {
  switch (role) {
    case "mafia":
      return (
        <path
          d="M6.5 10.5 C6.5 9.4 7.4 8.5 8.5 8.5 H11 C11 9.6 11.9 10.5 13 10.5 C14.1 10.5 15 9.6 15 8.5 H15.5 C16.6 8.5 17.5 9.4 17.5 10.5 V11.5 C17.5 12.6 16.6 13.5 15.5 13.5 H8.5 C7.4 13.5 6.5 12.6 6.5 11.5 Z"
          fill="none"
          stroke={color}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      );
    case "informer":
      return (
        <>
          <path
            d="M7 12 C8.5 9.5 10.1 8.3 12 8.3 C13.9 8.3 15.5 9.5 17 12 C15.5 14.5 13.9 15.7 12 15.7 C10.1 15.7 8.5 14.5 7 12 Z"
            fill="none"
            stroke={color}
            strokeWidth={1.1}
          />
          <circle cx="12" cy="12" r="1.6" fill={color} />
        </>
      );
    case "mafia_cop":
      return (
        <path
          d="M12 8 L13.1 10.4 L15.7 10.7 L13.8 12.5 L14.3 15.1 L12 13.8 L9.7 15.1 L10.2 12.5 L8.3 10.7 L10.9 10.4 Z"
          fill="none"
          stroke={color}
          strokeWidth={1}
          strokeDasharray="1.5 1.2"
          strokeLinejoin="round"
        />
      );
    case "detective":
      return (
        <>
          <circle cx="11" cy="10.5" r="3.2" fill="none" stroke={color} strokeWidth={1.2} />
          <line x1="13.4" y1="12.9" x2="16" y2="15.5" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
        </>
      );
    case "doctor":
      return (
        <path
          d="M11 7.5 H13 V10.5 H16 V12.5 H13 V15.5 H11 V12.5 H8 V10.5 H11 Z"
          fill={color}
        />
      );
    case "sniper":
      return (
        <>
          <circle cx="12" cy="12" r="3.5" fill="none" stroke={color} strokeWidth={1.1} />
          <line x1="12" y1="6.5" x2="12" y2="8.7" stroke={color} strokeWidth={1.1} />
          <line x1="12" y1="15.3" x2="12" y2="17.5" stroke={color} strokeWidth={1.1} />
          <line x1="6.5" y1="12" x2="8.7" y2="12" stroke={color} strokeWidth={1.1} />
          <line x1="15.3" y1="12" x2="17.5" y2="12" stroke={color} strokeWidth={1.1} />
        </>
      );
    case "civilian":
    default:
      return (
        <>
          <circle cx="12" cy="9.5" r="2.3" fill="none" stroke={color} strokeWidth={1.1} />
          <path
            d="M7.5 16.5 C7.5 13.9 9.5 12.3 12 12.3 C14.5 12.3 16.5 13.9 16.5 16.5"
            fill="none"
            stroke={color}
            strokeWidth={1.1}
            strokeLinecap="round"
          />
        </>
      );
  }
}

export default function RoleIcon({
  role,
  color = "currentColor",
  size = 24,
  className,
}: RoleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d={SHIELD_PATH} stroke={color} strokeWidth={1.3} strokeLinejoin="round" opacity={0.9} />
      <InnerGlyph role={role} color={color} />
    </svg>
  );
}
