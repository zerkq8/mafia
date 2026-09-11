import { AVATAR_COUNT, avatarUrl } from "@/lib/avatars";

interface Props {
  value: number;
  onChange: (index: number) => void;
}

/** منتقي أفاتار صغير وأنيق — شبكة تلتف (5 أعمدة) تعرض كل الخيارات مرة وحدة بدون تمرير، إطار ذهبي للمختار حاليًا */
export default function AvatarPicker({ value, onChange }: Props) {
  const indices = Array.from({ length: AVATAR_COUNT }, (_, i) => i + 1);
  return (
    <div>
      <label className="block text-xs mb-1.5" style={{ color: "#8A93A6" }}>
        اختر أفاتارك
      </label>
      <div
        className="grid gap-2 justify-items-center"
        style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
      >
        {indices.map((i) => {
          const selected = value === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange(i)}
              className="rounded-full overflow-hidden"
              style={{
                width: 56,
                height: 56,
                border: selected ? "2px solid #C9A227" : "2px solid transparent",
                boxShadow: selected ? "0 0 0 2px #0B0E14, 0 0 8px #C9A22766" : "none",
                padding: 0,
              }}
            >
              <img
                src={avatarUrl(i) || ""}
                alt={`أفاتار ${i}`}
                width={56}
                height={56}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
