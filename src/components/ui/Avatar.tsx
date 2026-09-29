/** Up to two initials from a name or email. */
export function initialsOf(label: string): string {
  const base = label.includes("@") ? label.split("@")[0] : label;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1 ? words[0].slice(0, 2) : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1);
  return letters.toUpperCase();
}

const sizes = {
  sm: "size-7 text-[10px]",
  md: "size-10 text-[13px]",
  lg: "size-12 text-[15px]",
};

type AvatarProps = {
  label: string;
  size?: keyof typeof sizes;
  className?: string;
};

/** Initials avatar. Placeholder until real avatars (DiceBear / upload) arrive in M2. */
export function Avatar({ label, size = "md", className = "" }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-[linear-gradient(160deg,#2a2e35,#1a1d22)] font-display font-semibold tracking-[0.04em] text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] ${sizes[size]} ${className}`}
    >
      {initialsOf(label)}
    </span>
  );
}

type AvatarStackProps = {
  people: { id: string; label: string }[];
  /** Total members, to show a "+N" chip for the ones not drawn. */
  total?: number;
  size?: "sm" | "md";
};

/** Overlapping avatars with an optional "+N" overflow chip. */
export function AvatarStack({ people, total, size = "sm" }: AvatarStackProps) {
  const extra = total !== undefined ? Math.max(total - people.length, 0) : 0;
  return (
    <span className="flex items-center" aria-hidden>
      {people.map((p, i) => (
        <Avatar
          key={p.id}
          label={p.label}
          size={size}
          className={`ring-2 ring-card ${i > 0 ? "-ml-2" : ""}`}
        />
      ))}
      {extra > 0 && (
        <span
          className={`num -ml-2 inline-flex items-center justify-center rounded-full bg-card-sunken font-mono text-[10px] text-muted ring-2 ring-card ${
            size === "sm" ? "size-7" : "size-10"
          }`}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
