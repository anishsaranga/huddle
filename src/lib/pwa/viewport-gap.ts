/**
 * iOS 26 standalone (Home Screen) WebKit bug: `100dvh`/`100vh` and the initial
 * containing block that `position: fixed` resolves against come out about
 * `safe-area-inset-bottom` (~34px) shorter than the physical screen, so
 * bottom-anchored chrome floats above the real bottom edge. We measure the
 * shortfall before first paint and expose it as `--vh-gap` on <html>; the
 * `h-app` / `min-h-app` / `bottom-app` utilities (globals.css) add it back.
 * Everywhere else the property stays unset and the CSS fallback (0px) applies.
 */

/** Larger shortfalls mean something else (keyboard, split view, an opaque system bar), not the bug. */
export const MAX_VH_GAP = 60;

/**
 * How far (px) the fixed-position containing block falls short of the screen.
 * 0 unless standalone + portrait; anything outside (0, MAX_VH_GAP] counts as 0.
 */
export function viewportGap(
  isStandalone: boolean,
  isPortrait: boolean,
  screenHeight: number,
  probeHeight: number,
): number {
  if (!isStandalone || !isPortrait) return 0;
  const gap = Math.round(screenHeight - probeHeight);
  return gap > 0 && gap <= MAX_VH_GAP ? gap : 0;
}

/**
 * Inline <head> script (runs before first paint): the same math as
 * `viewportGap`, against a hidden `position: fixed; inset: 0` probe. Only
 * writes `--vh-gap` when running standalone on iOS (`navigator.standalone`
 * is WebKit-only; `display-mode: standalone` alone would also match Android
 * and desktop PWAs, whose opaque system bars produce a similar but legitimate
 * shortfall). Re-measures on resize / orientation / bfcache restore / return
 * to foreground. The probe is attached only while measuring, so it never
 * shows up in the DOM React hydrates. Never throws.
 * tests/unit/viewport-gap.test.ts runs it against stubs and checks it agrees
 * with `viewportGap`.
 */
export const VIEWPORT_GAP_SCRIPT = `(function(){try{var w=window,d=document,n=navigator,r=d.documentElement,p;
function q(s){return!!(w.matchMedia&&w.matchMedia(s).matches)}
function m(){try{
if(!(n.standalone===true||(q("(display-mode: standalone)")&&/iP(hone|ad|od)/.test(n.userAgent))))return;
var g=0;
if(q("(orientation: portrait)")){
if(!p){p=d.createElement("div");p.setAttribute("aria-hidden","true");p.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;visibility:hidden;pointer-events:none"}
r.appendChild(p);g=Math.round(screen.height-p.getBoundingClientRect().height);r.removeChild(p);
if(!(g>0&&g<=${MAX_VH_GAP}))g=0}
r.style.setProperty("--vh-gap",g+"px")}catch(e){}}
m();
w.addEventListener("resize",m);w.addEventListener("orientationchange",m);w.addEventListener("pageshow",m);
d.addEventListener("visibilitychange",function(){if(d.visibilityState==="visible")m()})
}catch(e){}})()`;
