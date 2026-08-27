// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

/**
 * Figma marks every panel join with a 15x15 crosshair straddling the corner it
 * sits on. It ships two exports for this — `corner-panel.svg` and
 * `corner-row.svg` — which are byte-identical: the same two 0.4-alpha strokes
 * through the centre of a 15px box. One inline SVG replaces both, which also
 * keeps the stroke colour in the markup where the surrounding hairlines are
 * rather than locked inside an asset.
 *
 * The mark is always positioned by its own corner offsets (-7 / -7.5 / -8),
 * never by the panel's, so callers pass placement in `className`.
 */
export const CornerMark = ({ className = "" }: { className?: string }) => (
  <svg
    aria-hidden
    viewBox="0 0 15 15"
    fill="none"
    className={`pointer-events-none absolute z-[2] size-[15px] ${className}`}
  >
    <path d="M7.5 0V15" stroke="white" strokeOpacity="0.4" />
    <path d="M0 7.5H15" stroke="white" strokeOpacity="0.4" />
  </svg>
);
