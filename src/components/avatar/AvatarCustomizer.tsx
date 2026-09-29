"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  completeConfig,
  randomConfig,
  randomizeCategory,
  setOption,
  switchStyle,
} from "@/lib/avatar/config";
import { configKey, type AvatarConfig, type AvatarOptionValue } from "@/lib/avatar/key";
import { avatarDataUri } from "@/lib/avatar/render";
import {
  AVATAR_STYLES,
  humanizeValue,
  previewOverrides,
  STYLE_LIST,
  type AvatarCategory,
  type AvatarStyleDef,
  type ColorPart,
  type StyleId,
} from "@/lib/avatar/styles";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { PRESS_SCALE, spring } from "@/lib/ui/motion";
import { AvatarStage, type StagePulse } from "./AvatarStage";
import { CheckIcon, DiceIcon, NoneIcon, RedoIcon, ResetIcon, ShuffleIcon, UndoIcon } from "./icons";
import { useAvatarHistory } from "./useAvatarHistory";

export { useAvatarHistory } from "./useAvatarHistory";
export type { AvatarHistory } from "./useAvatarHistory";

const SELECT = SIGNAL.strain;
const ZOOM = 1.85;

/** transform-origin that puts the face center in the middle of a tile at ZOOM. */
function zoomOrigin([cx, cy]: readonly [number, number]): string {
  const o = (c: number) => ((0.5 - ZOOM * c) / (1 - ZOOM)) * 100;
  return `${o(cx).toFixed(1)}% ${o(cy).toFixed(1)}%`;
}
/** Slot-machine frame times (ms): accelerating → decelerating spin, then land. */
const SHUFFLE_FRAMES = [0, 60, 125, 195, 275, 370, 485];
const SHUFFLE_LAND = 640;

type Pick = { option: string; value: AvatarOptionValue; coalesce?: string };

type AvatarCustomizerProps = {
  value: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
  /** Category tab to open first. Default "hair". */
  initialCategory?: string;
  className?: string;
};

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      transition={spring.press}
      className="grid size-11 place-items-center rounded-full bg-white/[0.03] text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong),inset_0_1px_0_rgb(255_255_255/0.06)] transition-opacity disabled:opacity-30"
    >
      {children}
    </motion.button>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200"
      style={{
        background: checked ? SELECT : "var(--card-sunken)",
        boxShadow: checked
          ? `0 0 16px -2px ${alpha(SELECT, 60)}, inset 0 0 0 1px ${alpha(SELECT, 80)}`
          : "inset 0 1px 2px rgb(0 0 0 / 0.5), inset 0 0 0 1px var(--hairline-strong)",
      }}
    >
      <motion.span
        aria-hidden
        className="absolute left-0 top-[3px] size-6 rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.45)]"
        animate={{ x: checked ? 23 : 3 }}
        transition={spring.snappy}
      />
    </button>
  );
}

/** Soft white-or-ink check that reads on any swatch. */
function isLight(hex: string): boolean {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

const RAINBOW =
  "conic-gradient(from 90deg, #ff5a5f, #f4c53d, #2bd67b, #3d9bff, #8c9bff, #e279c7, #ff5a5f)";

function CustomColor({
  value,
  active,
  onPick,
  label,
  size = 32,
}: {
  value: string;
  active: boolean;
  onPick: (hex: string) => void;
  label: string;
  size?: number;
}) {
  return (
    <label
      className="relative grid shrink-0 cursor-pointer place-items-center rounded-full"
      style={{ width: size, height: size, background: RAINBOW }}
      title={`Custom ${label.toLowerCase()}`}
    >
      <span
        className="grid place-items-center rounded-full"
        style={{
          width: size - 10,
          height: size - 10,
          background: active ? `#${value}` : "var(--card)",
          boxShadow: "0 0 0 1px rgb(0 0 0 / 0.35)",
        }}
      >
        {!active && (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-text-2">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </span>
      {active && (
        <span
          aria-hidden
          className="absolute -inset-[3px] rounded-full"
          style={{ boxShadow: `0 0 0 2px ${SELECT}` }}
        />
      )}
      <input
        type="color"
        aria-label={`Custom ${label.toLowerCase()}`}
        value={`#${value}`}
        onChange={(e) => onPick(e.target.value.slice(1).toLowerCase())}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  );
}

function ColorRow({
  part,
  value,
  onPick,
}: {
  part: ColorPart;
  value: string;
  onPick: (p: Pick) => void;
}) {
  const inPalette = part.palette.includes(value);
  return (
    <div className="space-y-2">
      <p className="telemetry flex items-center gap-2 px-1">
        {part.label}
        <span className="text-dim">#{value.toUpperCase()}</span>
      </p>
      <div
        role="radiogroup"
        aria-label={part.label}
        className="no-scrollbar -mx-4 flex items-center gap-2.5 overflow-x-auto px-4 py-1.5"
      >
        {part.palette.map((hex) => {
          const selected = hex === value;
          return (
            <motion.button
              key={hex}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${part.label} #${hex}`}
              onClick={() => onPick({ option: part.option, value: hex })}
              whileTap={{ scale: 0.86 }}
              transition={spring.press}
              className="relative grid size-8 shrink-0 place-items-center rounded-full"
              style={{
                background: `#${hex}`,
                boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.14), inset 0 -3px 6px rgb(0 0 0 / 0.18)",
              }}
            >
              {selected && (
                <>
                  <motion.span
                    layoutId={`swatch-${part.option}`}
                    aria-hidden
                    className="absolute -inset-[4px] rounded-full"
                    style={{ boxShadow: `0 0 0 2px ${SELECT}, 0 0 12px ${alpha(SELECT, 55)}` }}
                    transition={spring.snappy}
                  />
                  <CheckIcon
                    width={12}
                    height={12}
                    className={isLight(hex) ? "text-[#0a0b0d]" : "text-white"}
                  />
                </>
              )}
            </motion.button>
          );
        })}
        <CustomColor
          value={value}
          active={!inPalette}
          label={part.label}
          onPick={(hex) => onPick({ option: part.option, value: hex, coalesce: part.option })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

type TileModel = {
  key: string;
  label: string;
  src: string;
  selected: boolean;
  pick: Pick;
  zoom: boolean;
  /** Overlay for the "none" tile. */
  none?: boolean;
};

const Tile = memo(function Tile({
  tile,
  index,
  origin,
  groupId,
  onPick,
}: {
  tile: TileModel;
  index: number;
  origin: string;
  groupId: string;
  onPick: (p: Pick) => void;
}) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={tile.selected}
      aria-label={tile.label}
      onClick={() => onPick(tile.pick)}
      initial={{ opacity: 0, scale: 0.9, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      whileTap={{ scale: 0.92 }}
      transition={{ ...spring.soft, delay: Math.min(index, 20) * 0.016 }}
      className="relative aspect-square w-full overflow-hidden rounded-[18px] bg-card-sunken"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 84px" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local SVG data URI */}
      <img
        src={tile.src}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
        className={`block size-full transition-[filter,opacity] duration-200 ${tile.none ? "opacity-55" : ""}`}
        style={tile.zoom ? { transform: `scale(${ZOOM})`, transformOrigin: origin } : undefined}
      />
      {tile.none && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-9 place-items-center rounded-full bg-[rgb(10_11_13/0.72)] text-text shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
            <NoneIcon />
          </span>
        </span>
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[18px] shadow-[inset_0_0_0_1px_var(--hairline)]" />
      {tile.selected && (
        <>
          <motion.span
            layoutId={groupId}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[18px]"
            style={{
              boxShadow: `inset 0 0 0 2.5px ${SELECT}, inset 0 0 22px ${alpha(SELECT, 45)}`,
            }}
            transition={spring.snappy}
          />
          <motion.span
            aria-hidden
            className="absolute right-1.5 top-1.5 grid size-[20px] place-items-center rounded-full text-white"
            style={{ background: SELECT, boxShadow: `0 2px 8px ${alpha(SELECT, 70)}` }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={spring.bouncy}
          >
            <CheckIcon width={11} height={11} />
          </motion.span>
        </>
      )}
    </motion.button>
  );
});

/** Build the thumbnails for a category from the live config. */
function useTiles(config: AvatarConfig, cat: AvatarCategory): TileModel[] {
  return useMemo(() => {
    const out: TileModel[] = [];
    const o = config.options;
    // Thumbnails may hide things that cover the feature (e.g. glasses over eyes).
    const cfg = { ...config, options: { ...o, ...previewOverrides(config.style, cat.id) } };
    const zoom = !!cat.zoom;
    if (cat.variant) {
      const v = cat.variant;
      const on = cat.toggle ? o[cat.toggle.option] === true : true;
      if (cat.toggle) {
        out.push({
          key: "__none",
          label: `No ${cat.toggle.label.toLowerCase()}`,
          src: avatarDataUri({ ...cfg, options: { ...cfg.options, [cat.toggle.option]: false } }),
          selected: !on,
          pick: { option: cat.toggle.option, value: false },
          zoom,
          none: true,
        });
      }
      for (const value of v.values) {
        out.push({
          key: value,
          label: `${cat.label}: ${humanizeValue(value)}`,
          src: avatarDataUri(setOption(cfg, cat, v.option, value)),
          selected: on && o[v.option] === value && Object.entries(v.implies ?? {}).every(([k, x]) => o[k] === x),
          pick: { option: v.option, value },
          zoom,
        });
      }
      return out;
    }
    // Color-only category: one live tile per swatch.
    const part = cat.colors?.[0];
    if (part) {
      for (const hex of part.palette) {
        out.push({
          key: hex,
          label: `${part.label} #${hex}`,
          src: avatarDataUri(setOption(cfg, cat, part.option, hex)),
          selected: o[part.option] === hex,
          pick: { option: part.option, value: hex },
          zoom,
        });
      }
    }
    return out;
  }, [config, cat]);
}

// ---------------------------------------------------------------------------
// Category tabs
// ---------------------------------------------------------------------------

function CategoryTabs({
  categories,
  active,
  onSelect,
  styleId,
}: {
  categories: readonly AvatarCategory[];
  active: string;
  onSelect: (id: string) => void;
  styleId: StyleId;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>(`[data-cat="${active}"]`);
    if (!strip || !el) return;
    const target = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }, [active, styleId, reduced]);

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Features"
      className="nav-chrome no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 py-1"
    >
      {categories.map((c) => {
        const selected = c.id === active;
        return (
          <motion.button
            key={c.id}
            data-cat={c.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(c.id)}
            whileTap={{ scale: 0.94 }}
            transition={spring.press}
            className={`relative h-9 shrink-0 rounded-full px-3.5 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors duration-200 ${
              selected ? "text-bg" : "text-muted"
            }`}
          >
            {selected && (
              <motion.span
                layoutId="avatar-cat-pill"
                aria-hidden
                className="absolute inset-0 rounded-full bg-white shadow-[0_1px_10px_rgb(255_255_255/0.2)]"
                transition={spring.snappy}
              />
            )}
            {!selected && (
              <span aria-hidden className="absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_var(--hairline)]" />
            )}
            <span className="relative">{c.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style carousel
// ---------------------------------------------------------------------------

const StyleCard = memo(function StyleCard({
  def,
  src,
  selected,
  onSelect,
}: {
  def: AvatarStyleDef;
  src: string;
  selected: boolean;
  onSelect: (id: StyleId) => void;
}) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${def.name} style`}
      onClick={() => onSelect(def.id)}
      whileTap={{ scale: PRESS_SCALE - 0.04 }}
      transition={spring.press}
      className="flex w-[76px] shrink-0 snap-center flex-col items-center gap-2"
    >
      <span className="relative block size-[64px]">
        <motion.span
          className="block size-full overflow-hidden rounded-full"
          animate={{ scale: selected ? 1 : 0.86, opacity: selected ? 1 : 0.62 }}
          transition={spring.snappy}
          style={{ boxShadow: "inset 0 0 0 1px var(--hairline-strong)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG data URI */}
          <img src={src} alt="" width={64} height={64} draggable={false} decoding="async" className="block size-full" />
        </motion.span>
        {selected && (
          <motion.span
            layoutId="avatar-style-ring"
            aria-hidden
            className="absolute -inset-[5px] rounded-full"
            style={{ boxShadow: `0 0 0 2px ${SELECT}, 0 0 18px ${alpha(SELECT, 55)}` }}
            transition={spring.snappy}
          />
        )}
      </span>
      <span
        className={`w-full truncate text-center font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] transition-colors ${
          selected ? "text-text" : "text-dim"
        }`}
      >
        {def.name}
      </span>
    </motion.button>
  );
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Game-style character creator for DiceBear avatars. Controlled: renders
 * `value`, reports every change through `onChange` (with built-in undo/redo).
 */
export function AvatarCustomizer({ value, onChange, initialCategory = "hair", className = "" }: AvatarCustomizerProps) {
  const reduced = useReducedMotion();
  const cfg = useMemo(() => completeConfig(value), [value]);
  const history = useAvatarHistory(cfg, onChange);
  const [initial] = useState(cfg);
  const [pulse, setPulse] = useState<StagePulse>({ n: 0, kind: "pop" });
  const [frame, setFrame] = useState<AvatarConfig | null>(null);
  const timers = useRef<number[]>([]);
  const [catId, setCatId] = useState(initialCategory);

  const def = AVATAR_STYLES[cfg.style];
  const category = def.categories.find((c) => c.id === catId) ?? def.categories.find((c) => c.id === "hair") ?? def.categories[0];
  const shuffling = frame !== null;

  const bump = useCallback((kind: StagePulse["kind"]) => setPulse((p) => ({ n: p.n + 1, kind })), []);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // Stable handlers for memoized tiles: read the latest state from a ref.
  const latest = useRef({ cfg, category, commit: history.commit, bump });
  useLayoutEffect(() => {
    latest.current = { cfg, category, commit: history.commit, bump };
  });

  const onPick = useCallback((p: Pick) => {
    const { cfg: c, category: cat, commit, bump: b } = latest.current;
    const next = setOption(c, cat, p.option, p.value);
    if (configKey(next) === configKey(c)) return;
    commit(next, p.coalesce ? { coalesce: p.coalesce } : undefined);
    if (!p.coalesce) b("pop");
  }, []);

  const onStyle = useCallback((id: StyleId) => {
    const { cfg: c, commit, bump: b } = latest.current;
    if (id === c.style) return;
    commit(switchStyle(c, id));
    b("land");
  }, []);

  const randomizeAll = () => {
    if (shuffling) return;
    const final = randomConfig(cfg.style);
    if (reduced) {
      history.commit(final);
      bump("pop");
      return;
    }
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = SHUFFLE_FRAMES.map((ms) =>
      window.setTimeout(() => {
        setFrame(randomConfig(cfg.style));
        bump("tick");
      }, ms),
    );
    timers.current.push(
      window.setTimeout(() => {
        setFrame(null);
        history.commit(final);
        bump("land");
      }, SHUFFLE_LAND),
    );
  };

  const shuffleCategory = () => {
    history.commit(randomizeCategory(cfg, category.id));
    bump("pop");
  };

  const undo = () => {
    history.undo();
    bump("pop");
  };
  const redo = () => {
    history.redo();
    bump("pop");
  };
  const reset = () => {
    history.commit(initial);
    bump("land");
  };

  const styleThumbs = useMemo(
    () => STYLE_LIST.map((s) => ({ def: s, src: avatarDataUri(switchStyle(cfg, s.id)) })),
    // Only the seed and background feed the style previews.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg.seed, cfg.options.backgroundColor],
  );

  const tiles = useTiles(cfg, category);
  const toggleOn = category.toggle ? cfg.options[category.toggle.option] === true : true;
  const showColorRows = !!category.variant && (category.colors?.length ?? 0) > 0;
  const colorOnly = !category.variant && category.colors?.[0];
  const variantCount = category.variant?.values.length ?? category.colors?.[0]?.palette.length ?? 0;
  const traitCount = def.categories.length;
  const isInitial = configKey(cfg) === configKey(initial);

  return (
    <div className={`space-y-5 ${className}`}>
      <AvatarStage
        config={frame ?? cfg}
        pulse={pulse}
        corners={{
          tl: "// Avatar",
          tr: def.name,
          bl: `Seed ${cfg.seed.slice(0, 8)}`,
          br: shuffling ? "Rolling…" : `${traitCount} traits`,
        }}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <IconButton label="Undo" onClick={undo} disabled={!history.canUndo || shuffling}>
          <UndoIcon />
        </IconButton>
        <IconButton label="Redo" onClick={redo} disabled={!history.canRedo || shuffling}>
          <RedoIcon />
        </IconButton>
        <IconButton label="Reset" onClick={reset} disabled={isInitial || shuffling}>
          <ResetIcon />
        </IconButton>
        <motion.button
          type="button"
          onClick={randomizeAll}
          aria-busy={shuffling || undefined}
          whileTap={{ scale: PRESS_SCALE }}
          transition={spring.press}
          className="relative ml-auto inline-flex h-11 select-none items-center gap-2 rounded-full bg-white px-5 text-[13px] font-semibold uppercase tracking-[0.12em] text-bg shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_6px_20px_-8px_rgb(255_255_255/0.35)]"
        >
          <motion.span
            className="grid place-items-center"
            animate={shuffling ? { rotate: [0, 360] } : { rotate: 0 }}
            transition={shuffling ? { duration: 0.32, repeat: Infinity, ease: "linear" } : spring.snappy}
          >
            <DiceIcon />
          </motion.span>
          Randomize
        </motion.button>
      </div>

      {/* Style carousel */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between px-1">
          <h3 className="telemetry text-text-2">{"// Style"}</h3>
          <p className="telemetry text-dim">{def.tagline}</p>
        </div>
        <div
          role="radiogroup"
          aria-label="Avatar style"
          className="no-scrollbar -mx-4 flex snap-x gap-1 overflow-x-auto px-4 pb-1 pt-1.5"
        >
          {styleThumbs.map(({ def: s, src }) => (
            <StyleCard key={s.id} def={s} src={src} selected={s.id === cfg.style} onSelect={onStyle} />
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="space-y-3">
        <CategoryTabs categories={def.categories} active={category.id} onSelect={setCatId} styleId={cfg.style} />

        <motion.div
          key={`${cfg.style}:${category.id}`}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.soft}
          className="surface space-y-4 p-4"
          role="tabpanel"
          aria-label={category.label}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[26px] font-bold uppercase leading-none tracking-[0.02em]">
                {category.label}
              </h3>
              <p className="telemetry mt-1.5">
                {variantCount} {colorOnly ? "colors" : variantCount === 1 ? "option" : "options"}
                {category.toggle && (
                  <span style={{ color: toggleOn ? SELECT : undefined }}> · {toggleOn ? "On" : "Off"}</span>
                )}
              </p>
            </div>
            <IconButton label={`Shuffle ${category.label.toLowerCase()}`} onClick={shuffleCategory}>
              <ShuffleIcon />
            </IconButton>
            {category.toggle && (
              <Switch
                checked={toggleOn}
                label={category.toggle.label}
                onChange={(v) => onPick({ option: category.toggle!.option, value: v })}
              />
            )}
          </div>

          {showColorRows &&
            category.colors!.map((part) => (
              <ColorRow key={part.option} part={part} value={String(cfg.options[part.option])} onPick={onPick} />
            ))}

          <div role="radiogroup" aria-label={category.label} className="grid grid-cols-4 gap-2.5">
            {tiles.map((t, i) => (
              <Tile
                key={t.key}
                tile={t}
                index={i}
                origin={zoomOrigin(def.faceCenter)}
                groupId={`tile-sel-${cfg.style}-${category.id}`}
                onPick={onPick}
              />
            ))}
            {colorOnly && (
              <div className="grid aspect-square place-items-center rounded-[18px] bg-card-sunken shadow-[inset_0_0_0_1px_var(--hairline)]">
                <div className="flex flex-col items-center gap-1.5">
                  <CustomColor
                    size={40}
                    value={String(cfg.options[colorOnly.option])}
                    active={!colorOnly.palette.includes(String(cfg.options[colorOnly.option]))}
                    label={colorOnly.label}
                    onPick={(hex) => onPick({ option: colorOnly.option, value: hex, coalesce: colorOnly.option })}
                  />
                  <span className="telemetry text-[9px]">Custom</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </section>
    </div>
  );
}
