/**
 * Turning a dragged rectangle into a set of elements (§11).
 *
 * Pure geometry, with the rectangles injected. jsdom returns all-zero rects from
 * `getBoundingClientRect`, so a version of this that measured for itself could
 * not be tested at all — and this is the one part of selection where "it picked
 * the wrong thing" is a silent, arguable failure rather than a crash.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How far the pointer must travel before a gesture stops being a click.
 *
 * Generous on purpose: a click on a button carries 1–3px of hand tremor, and a
 * click that silently opened a marquee popup would make the fast path — click to
 * pin — feel like it had failed.
 */
export const DRAG_MIN = 6;

/** How much of an element must be inside the box for it to count as selected. */
export const COVERAGE_MIN = 0.55;

/** Beyond this the prompt is a list, not a request. */
export const MAX_TARGETS = 8;

export function boxFrom(ax: number, ay: number, bx: number, by: number): Box {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    right: Math.max(ax, bx),
    bottom: Math.max(ay, by),
  };
}

export function boxArea(b: Box): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
}

export function boxCentre(b: Box): { x: number; y: number } {
  return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
}

/**
 * The fraction of `inner` that lies inside `outer`.
 *
 * Not "do they overlap". A drag across the middle of a section overlaps the
 * section itself, every wrapper in it and the body — using intersection alone
 * would select the whole page every time.
 */
export function coverage(inner: Box, outer: Box): number {
  const area = boxArea(inner);
  if (area <= 0) return 0;
  const overlap = boxArea({
    left: Math.max(inner.left, outer.left),
    top: Math.max(inner.top, outer.top),
    right: Math.min(inner.right, outer.right),
    bottom: Math.min(inner.bottom, outer.bottom),
  });
  return overlap / area;
}

/**
 * Which of `candidates` the drag selected.
 *
 * Two rules, and the second is the one that makes this usable. Take everything
 * mostly inside the box; then drop anything whose ancestor was also taken. A
 * heading, its card and the grid around it are all "inside" a wide drag, and
 * naming all three would hand the agent the same request three times at three
 * levels of nesting. The outermost one is what the user drew a box around.
 *
 * Input order is preserved, so passing candidates in document order gets targets
 * back in reading order — which is the order the prompt lists them in.
 */
export function pickInBox<T extends Element>(
  candidates: readonly T[],
  marquee: Box,
  rectOf: (el: T) => Box,
  max: number = MAX_TARGETS,
): T[] {
  const inside = candidates.filter((el) => coverage(rectOf(el), marquee) >= COVERAGE_MIN);
  const outermost = inside.filter((el) => !inside.some((other) => other !== el && other.contains(el)));
  return outermost.slice(0, max);
}
