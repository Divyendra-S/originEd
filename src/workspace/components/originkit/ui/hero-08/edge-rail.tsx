// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

/**
 * The hatched margins either side of the canvas (Figma `rail-texture.svg`).
 *
 * The export is a 120x756 SVG whose fill is a 7px `<pattern>` tile — one
 * `M0 7 L7 0` stroke at 0.8 alpha, the whole rect then dropped to 0.1. Two
 * numbers come straight back out of that: the visible stroke is 0.08 alpha, and
 * 45-degree lines repeating every 7px in both axes are 7/sqrt(2) = 4.9497px
 * apart measured perpendicular. That is a `repeating-linear-gradient`, so the
 * rail is re-derived rather than re-exported.
 *
 * It has to be. The export is a fixed 120x756 bitmap-shaped box, and these rails
 * no longer are: they run from the canvas edge to the edge of the screen at
 * whatever width that is (see `section-hero.tsx`). An <img> stretched to fill
 * would shear the hatch off 45 degrees; a repeating gradient re-tiles.
 *
 * Figma mirrors the right rail with `scaleX(-1)`, which flips the hatch to lean
 * the other way — 135deg becomes 45deg, no transform needed.
 *
 * The one thing dropped from the export is the 1px white/10 line it paints down
 * its outer edge. In the 1280 frame that line is the frame's own border; here
 * the rail ends at the viewport, so the line would sit on the screen edge where
 * it reads as a rendering artefact. The inner hairline — the one that actually
 * separates rail from canvas — is kept as a border.
 */
const HATCH = (angle: string) =>
  `repeating-linear-gradient(${angle}, rgba(255,255,255,0.08) 0 1px, rgba(255,255,255,0) 1px 4.9497px)`;

export const EdgeRail = ({ side }: { side: "left" | "right" }) => (
  <div
    aria-hidden
    className={`pointer-events-none relative z-0 shrink grow basis-[16px] bg-white/[0.02] ipad:basis-[48px] desktop-sm:basis-[120px] ${
      side === "left" ? "border-r" : "border-l"
    } border-white/10`}
    style={{ backgroundImage: HATCH(side === "left" ? "135deg" : "45deg") }}
  />
);
