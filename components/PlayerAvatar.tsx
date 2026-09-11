import { avatarUrl } from "@/lib/avatars";
import { NeutralPersonIcon } from "@/components/icons/RoleIcon";

interface Props {
  avatarIndex?: number | null;
  size?: number;
  color?: string;
  className?: string;
}

/** صورة أفاتار اللاعب لو مختار وحدة، وإلا أيقونة محايدة كبديل (لاعبين قدامى قبل الميزة أو الحكم) */
export default function PlayerAvatar({ avatarIndex, size = 24, color = "#8A93A6", className }: Props) {
  const url = avatarUrl(avatarIndex);
  if (!url) {
    return <NeutralPersonIcon color={color} size={size} className={className} />;
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
    />
  );
}
