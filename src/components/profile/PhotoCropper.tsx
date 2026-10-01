"use client";

import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ease } from "@/lib/ui/motion";

/** Output size of the cropped square (px). The server re-encodes to the same size. */
export const CROP_OUTPUT_PX = 512;
const MAX_ZOOM = 4;
const MIN_ZOOM = 1;

type Loaded = { url: string; w: number; h: number };
type View = { zoom: number; x: number; y: number };
type Pt = { x: number; y: number };

const subscribe = () => () => {};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep the crop circle fully covered by the image. */
function clampView(v: View, img: { w: number; h: number }, d: number): View {
  const scale = (d / Math.min(img.w, img.h)) * v.zoom;
  const maxX = Math.max(0, (img.w * scale - d) / 2);
  const maxY = Math.max(0, (img.h * scale - d) / 2);
  return { zoom: v.zoom, x: clamp(v.x, -maxX, maxX), y: clamp(v.y, -maxY, maxY) };
}

type PhotoCropperProps = {
  /** The picked photo. */
  file: File;
  onCancel: () => void;
  /** Called with the cropped 512px JPEG. Resolve to an error message to show it, or null on success. */
  onConfirm: (blob: Blob) => Promise<string | null>;
  /** Called when the user wants a different photo. */
  onPickAnother: () => void;
};

/**
 * Full-screen circular crop. Drag to move, pinch (or wheel / slider) to zoom;
 * the output is the square inside the circle, drawn to a 512px canvas.
 */
export function PhotoCropper({ file, onCancel, onConfirm, onPickAnother }: PhotoCropperProps) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [d, setD] = useState(280);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest geometry for handlers (avoids stale closures during gestures).
  const geo = useRef({ img: null as Loaded | null, d: 280, view });
  useLayoutEffect(() => {
    geo.current = { img, d, view };
  });

  // Decode the picked file (EXIF orientation is applied by the browser's decoder).
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    let cancelled = false;
    el.onload = () => {
      if (cancelled) return;
      if (!el.naturalWidth || !el.naturalHeight) {
        setLoadError(true);
        return;
      }
      setImg({ url, w: el.naturalWidth, h: el.naturalHeight });
    };
    el.onerror = () => {
      if (!cancelled) setLoadError(true);
    };
    el.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Circle diameter follows the stage size.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !mounted) return;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      setD(Math.max(160, Math.min(360, Math.floor(Math.min(r.width, r.height) - 48))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [mounted]);

  const update = useCallback((next: View | ((v: View) => View)) => {
    setView((cur) => {
      const g = geo.current;
      const v = typeof next === "function" ? next(cur) : next;
      const zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
      return g.img ? clampView({ ...v, zoom }, g.img, g.d) : { ...v, zoom };
    });
  }, []);

  // Re-clamp when the circle resizes.
  useEffect(() => {
    update((v) => v);
  }, [d, img, update]);

  /** Zoom about the circle center: keep the same image point under it. */
  const zoomTo = useCallback(
    (zoom: number) => {
      update((v) => {
        const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
        const k = z / v.zoom;
        return { zoom: z, x: v.x * k, y: v.y * k };
      });
    },
    [update],
  );

  // ---- gestures ----
  const pointers = useRef(new Map<number, Pt>());
  const base = useRef<{ view: View; mid: Pt; dist: number } | null>(null);

  const rebase = () => {
    const pts = [...pointers.current.values()];
    if (pts.length === 0) {
      base.current = null;
      return;
    }
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    base.current = { view: geo.current.view, mid, dist };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebase();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !base.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const b = base.current;
    let zoom = b.view.zoom;
    if (pts.length >= 2 && b.dist > 0) {
      zoom = clamp(b.view.zoom * (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / b.dist), MIN_ZOOM, MAX_ZOOM);
    }
    const k = zoom / b.view.zoom;
    update({ zoom, x: b.view.x * k + (mid.x - b.mid.x), y: b.view.y * k + (mid.y - b.mid.y) });
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    rebase();
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    zoomTo(geo.current.view.zoom * Math.exp(-e.deltaY * 0.0015));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 30 : 10;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      update((v) => ({ ...v, x: v.x + m[0], y: v.y + m[1] }));
    } else if (e.key === "+" || e.key === "=") zoomTo(view.zoom * 1.1);
    else if (e.key === "-") zoomTo(view.zoom / 1.1);
  };

  // ---- output ----
  const confirm = async () => {
    if (!img || busy) return;
    setBusy(true);
    setError(null);
    try {
      const el = new Image();
      el.src = img.url;
      await el.decode();
      const scale = (d / Math.min(img.w, img.h)) * view.zoom;
      const size = d / scale; // crop side in source pixels
      const cx = img.w / 2 - view.x / scale;
      const cy = img.h / 2 - view.y / scale;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = CROP_OUTPUT_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#0a0b0d";
      ctx.fillRect(0, 0, CROP_OUTPUT_PX, CROP_OUTPUT_PX);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(el, cx - size / 2, cy - size / 2, size, size, 0, 0, CROP_OUTPUT_PX, CROP_OUTPUT_PX);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("encode failed");
      const message = await onConfirm(blob);
      if (message) setError(message);
    } catch {
      setError("Couldn't process that photo. Try another one.");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  const scale = img ? (d / Math.min(img.w, img.h)) * view.zoom : 1;

  return createPortal(
    <motion.div
        key="cropper"
        role="dialog"
        aria-modal="true"
        aria-label="Adjust photo"
        className="fixed inset-x-0 top-0 bottom-app z-[65] flex flex-col bg-bg"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: ease.out }}
      >
        <header className="pt-safe px-safe">
          <div className="flex h-14 items-center justify-between px-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="h-11 rounded-full px-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-text-2 disabled:opacity-40"
            >
              Cancel
            </button>
            <h2 className="font-display text-[22px] font-bold uppercase leading-none tracking-wide">Adjust photo</h2>
            <span className="w-[72px]" aria-hidden />
          </div>
        </header>

        {/* Stage */}
        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role="application"
          aria-label="Crop area. Drag to move the photo. Pinch, scroll or use the slider to zoom."
        >
          {img && (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL, sized by the crop math
            <img
              src={img.url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: img.w * scale,
                height: img.h * scale,
                transform: `translate3d(${view.x - (img.w * scale) / 2}px, ${view.y - (img.h * scale) / 2}px, 0)`,
                willChange: "transform",
              }}
            />
          )}
          {!img && !loadError && <div aria-hidden className="absolute inset-0 grid place-items-center"><span className="animate-spin-fast size-6 rounded-full border-2 border-muted border-r-transparent" /></div>}

          {/* Circular mask: everything outside the circle is dimmed. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: d,
              height: d,
              transform: "translate(-50%, -50%)",
              boxShadow: "0 0 0 100vmax rgb(10 11 13 / 0.78), inset 0 0 0 1.5px rgb(255 255 255 / 0.75), 0 0 32px rgb(61 155 255 / 0.25)",
            }}
          >
            {/* Rule-of-thirds guides */}
            <div className="absolute inset-0 overflow-hidden rounded-full opacity-50">
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
            </div>
          </div>

          {loadError && (
            <div className="absolute inset-0 grid place-items-center px-8 text-center">
              <div>
                <p className="label mb-2 text-recovery-red">Can&rsquo;t open photo</p>
                <p className="mx-auto max-w-[30ch] text-[15px] leading-relaxed text-muted">
                  We couldn&rsquo;t read that image. HEIC photos sometimes fail here, so try a JPG or PNG.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="px-safe">
        <div className="px-6 pt-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
          <div className="mb-4 flex items-center gap-3">
            <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="shrink-0 text-muted">
              <circle cx="7.5" cy="7.5" r="4.5" />
              <path d="m11 11 4 4M5.5 7.5h4" />
            </svg>
            <input
              type="range"
              className="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={view.zoom}
              disabled={!img}
              aria-label="Zoom"
              onChange={(e) => zoomTo(Number(e.target.value))}
              style={{ "--pct": `${((view.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%`, "--range-color": "var(--strain)" } as React.CSSProperties}
            />
            <svg aria-hidden width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="shrink-0 text-muted">
              <circle cx="7.5" cy="7.5" r="4.5" />
              <path d="m11 11 4 4M5.5 7.5h4M7.5 5.5v4" />
            </svg>
          </div>

          {error && (
            <p role="alert" className="mb-3 text-center text-[14px] leading-snug text-recovery-red">
              {error}
            </p>
          )}

          {loadError ? (
            <Button variant="primary" size="lg" fullWidth onClick={onPickAnother}>
              Choose another photo
            </Button>
          ) : (
            <div className="space-y-2">
              <Button variant="primary" size="lg" fullWidth onClick={confirm} loading={busy} disabled={!img}>
                Use photo
              </Button>
              <Button variant="ghost" size="md" fullWidth onClick={onPickAnother} disabled={busy}>
                Choose another
              </Button>
            </div>
          )}
        </div>
        </div>
    </motion.div>,
    document.body,
  );
}
