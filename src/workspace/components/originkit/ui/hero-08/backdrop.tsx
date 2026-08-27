// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

function asset(file: string) {
  return `/originkit/hero-08/${file}`;
}

/**
 * Three light layers, each on a different owner because each is anchored to a
 * different thing.
 *
 * `PageGlow` and `PageGrain` sit on the section and bleed the full viewport —
 * capping them at the stage would put a hard edge where the design has none.
 * `CanvasWash` and `PatternField` belong to the canvas and cap with it.
 */

/**
 * Figma paints the phone and tablet frames on a lit ground: an ellipse of
 * rgba(51,51,51,0.8) fading to the page black, centred slightly below middle.
 * Only its two radii change between frames, so they are the drivers and the
 * gradient is written once.
 *
 * The desktop frame has no such fill — it lights the canvas instead (see
 * `CanvasWash`), which is why this layer switches off at `desktop-sm:`.
 */
const PAGE_GLOW =
  "radial-gradient(ellipse var(--glow-w) var(--glow-h) at 50% 54.6%, rgba(51,51,51,0.8), rgba(8,8,8,0) 100%)";

export const PageGlow = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 z-0 [--glow-h:479px] [--glow-w:271px] ipad:[--glow-h:618px] ipad:[--glow-w:432px] desktop-sm:hidden"
    style={{ backgroundImage: PAGE_GLOW }}
  />
);

/**
 * A 60px noise tile at 8% on `screen`, so only the grain lifts and the black
 * stays black. This is the one place an image is unavoidable — noise has no
 * closed form in CSS — and it is why the section root carries `isolate`: without
 * it the blend would reach past the section into whatever renders below.
 */
export const PageGrain = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 z-0 bg-[length:60px_60px] bg-repeat opacity-[0.08] mix-blend-screen"
    style={{ backgroundImage: `url(${asset("noise-overlay.png")})` }}
  />
);

/**
 * The desktop frame's light, held to the top 756px of the canvas rather than to
 * `inset-0`. The canvas grows past 756 on any screen taller than the 832 frame
 * (see the height note in `section-hero.tsx`); pinned to the full box the
 * ellipse would re-centre with it and slide out from behind the globe it exists
 * to light. Anchored to the band, it stays where Figma put it.
 */
const CANVAS_WASH =
  "radial-gradient(ellipse 54% 48% at 50% 50%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.07) 36%, rgba(255,255,255,0) 72%)";

export const CanvasWash = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-x-0 top-0 z-0 hidden h-[756px] desktop-sm:block"
    style={{ backgroundImage: CANVAS_WASH }}
  />
);

/** Feathers the arc field out before it reaches the trusted-by strips. */
const PATTERN_MASK = "linear-gradient(to bottom, #000 0%, transparent 100%)";

/**
 * The swept arc field behind the copy (`pattern.svg`, 1048x814). Genuine
 * line art, so it ships as the export — but it is always drawn at its native
 * 1040 width and *cropped* to the frame, never scaled to it. Figma's own numbers
 * say so: the phone clips 335px off each side (1040 - 670 = 370, the canvas) and
 * the tablet clips 196px (1040 - 392 = 648, the canvas). Scaling instead would
 * change the arc curvature between frames; clipping keeps one drawing and shows
 * more of it as the frame widens, which is what the three frames actually show.
 *
 * The desktop is the one frame that shows the whole drawing, so there it takes
 * the canvas width instead of a clip. That width is no longer a constant — the
 * canvas grows to 1920 before the rails do — so it is `w-full` rather than
 * Figma's 1040, and the arcs stretch with it. They are a 25%-opacity ambience
 * behind a mask, not a measured object; stretching reads as the sweep opening
 * out, where clipping at 1040 would leave the field ending mid-canvas.
 */
export const PatternField = () => (
  <img
    src={asset("pattern.svg")}
    alt=""
    aria-hidden
    className="pointer-events-none absolute top-0 left-1/2 z-0 h-[805.67px] w-[1040px] max-w-none -translate-x-1/2 object-fill opacity-25 brightness-[1.35] [clip-path:inset(0_335px)] ipad:h-[1163px] ipad:[clip-path:inset(0_196px_95px)] desktop-sm:left-0 desktop-sm:h-[806px] desktop-sm:w-full desktop-sm:translate-x-0 desktop-sm:object-left-top desktop-sm:brightness-[1.45] desktop-sm:[clip-path:none]"
    style={{ maskImage: PATTERN_MASK, WebkitMaskImage: PATTERN_MASK }}
  />
);
