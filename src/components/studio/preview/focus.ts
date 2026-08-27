/**
 * Which page the preview is showing (§10).
 *
 * The workspace is a flat list of sections, but the site it renders is not: the
 * hero and the features are one landing page and hero-08 is a different design.
 * Stacked in one scroll they read as a page that does not exist, so the preview
 * renders exactly one page at a time, chosen from the switcher in the header.
 * There is no "all of them" option — that was the confusing thing.
 *
 * A query parameter rather than a message, because the preview must keep
 * SERVER-rendering. Hiding the other page with CSS would have avoided the
 * reload, but a hidden `<canvas>` keeps its rAF loop — looking at one hero would
 * still pay for the other one animating behind it. This way it unmounts.
 *
 * Pure, and here rather than in the bridge, for the same reason `viewport.ts`
 * is: the interesting part is one edge case, and it is testable without a
 * browser.
 */

/** The iframe's `src`. Always names a page — there is no unfocused state. */
export function previewSrc(page: string): string {
  return `/preview?page=${encodeURIComponent(page)}`;
}

/**
 * The page, minus one that is no longer in the manifest.
 *
 * The agent can rewrite `pages` mid-conversation, including the entry being
 * looked at, and a slug the manifest no longer has renders the first page in the
 * frame while the switcher still shows the old name. Falling back keeps the two
 * telling the same story.
 *
 * Derived rather than corrected in an effect: `setState` during render is the
 * lint rule this repo enforces, and the stale value costs nothing — if the page
 * comes back, so does the focus.
 *
 * Takes the list rather than importing it so the edge case can be asserted
 * against a fixture instead of against whatever the workspace happens to be.
 */
export function livePage(page: string, all: readonly { slug: string }[]): string {
  if (all.length === 0) return page;
  return all.some((p) => p.slug === page) ? page : all[0].slug;
}
