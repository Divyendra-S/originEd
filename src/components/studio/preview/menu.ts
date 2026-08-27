/**
 * Where the keyboard goes next in an open menu.
 *
 * Pulled out of the component for the same reason `focus.ts` and `viewport.ts`
 * are: it is the only part of a dropdown with rules worth stating, and off-by-one
 * wrap-around is exactly the kind of thing that is easy to write wrong and
 * tedious to catch by hand.
 *
 * Returns the index to move to, or `null` for a key the menu does not handle —
 * so the caller knows whether to `preventDefault` rather than having to guess.
 */
export function nextIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;

  switch (key) {
    // Wrapping, not clamping. A list this short is a ring: pressing Down on the
    // last page to get back to the first is quicker than reversing direction.
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
