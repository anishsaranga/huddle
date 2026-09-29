type DialProps = {
  /** Current value. Clamped to [0, max]. */
  value: number;
  /** Value at which the ring is full. */
  max: number;
  /** Ring color (any CSS color, e.g. "var(--recovery-green)"). */
  color: string;
  /** ALL-CAPS label rendered below the ring. */
  label: string;
  /** Text shown in the center, e.g. "72%" or "11.4". */
  display: string;
  /** Outer diameter of the ring in px. */
  size?: number;
  className?: string;
};

/**
 * Ring dial: rounded-cap progress arc starting at 12 o'clock, big condensed
 * numeral in the center, small label underneath. Pure SVG, server-renderable.
 */
export function Dial({
  value,
  max,
  color,
  label,
  display,
  size = 104,
  className = "",
}: DialProps) {
  const stroke = Math.max(4, Math.round(size * 0.09));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio =
    max > 0 && Number.isFinite(value) ? Math.min(Math.max(value / max, 0), 1) : 0;
  const dashOffset = circumference * (1 - ratio);
  const center = size / 2;

  return (
    <div
      className={`flex flex-col items-center gap-2 ${className}`}
      role="img"
      aria-label={`${label}: ${display}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={stroke}
          />
          {ratio > 0 && (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          )}
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center font-display font-semibold leading-none tabular-nums text-white"
          style={{ fontSize: Math.round(size * 0.34) }}
        >
          {display}
        </span>
      </div>
      <span className="label">{label}</span>
    </div>
  );
}
