/**
 * THE SOURCE OF TRUTH for what the page is made of, and in what order.
 *
 * Pure data on purpose — no React, no imports. Both the browser (to render) and
 * the server (to map a changed file back to a section name for the ChangeCard,
 * §12) read this, and the server must be able to without pulling a client
 * component graph through a route handler.
 *
 * The agent edits this file directly, which is why there is no `sections` table
 * in Postgres to keep in sync (§9).
 */
export interface SectionEntry {
  /** Stable id. Used by the inspector, comments and context pins. */
  slug: string;
  /** What a human sees in the chat: "Hero", not "sections/hero.tsx". */
  label: string;
  /** Path relative to the workspace root. */
  file: string;
}

export const sections = [
  { slug: "hero", label: "Hero", file: "sections/hero.tsx" },
  { slug: "features", label: "Features", file: "sections/features.tsx" },
  { slug: "hero-08", label: "Hero 08", file: "sections/hero-08.tsx" },
] as const satisfies readonly SectionEntry[];

export type SectionSlug = (typeof sections)[number]["slug"];

/**
 * A PAGE is a set of sections you look at together — one screen of the site.
 *
 * `sections` above is a flat list because that is what the agent edits and what
 * the server maps files onto. But the flat list is not what a person sees: the
 * hero and the features are one landing page, and hero-08 is a different design
 * entirely. Stacking all three in one scroll shows a page that does not exist.
 *
 * So the preview renders exactly ONE page at a time, chosen from the switcher in
 * the header, and there is deliberately no "everything at once" option — that
 * was the confusing thing, not a feature being removed.
 *
 * Membership lives here rather than as a `page:` key on each section for one
 * practical reason: `add_section` writes `{ slug, label, file }` entry lines into
 * the array above (see `section.codegen.ts`), and a fourth required key would
 * mean either teaching the codegen about pages or letting the agent write
 * sections that belong nowhere. Instead, a section no page claims falls onto the
 * first page — see `sectionsForPage`.
 */
export interface PageEntry {
  slug: string;
  label: string;
  /** Section slugs. Render order comes from `sections`, not from this list. */
  sections: readonly string[];
}

export const pages = [
  { slug: "landing", label: "Landing", sections: ["hero", "features"] },
  { slug: "hero-08", label: "Hero 08", sections: ["hero-08"] },
] as const satisfies readonly PageEntry[];

/** The one the studio opens on, and the home for anything unclaimed. */
export const HOME_PAGE: string = pages[0].slug;

/** Every slug some page names. Anything outside this belongs to `HOME_PAGE`. */
function claimedSlugs(): Set<string> {
  const out = new Set<string>();
  for (const page of pages) for (const slug of page.sections) out.add(slug);
  return out;
}

/**
 * The sections on one page, in manifest order.
 *
 * An unknown or missing page slug answers with the first page rather than with
 * nothing: a hand-typed URL, or a page the agent has just deleted, should not
 * render a blank frame. The return type is deliberately left inferred — it is
 * the union of the literal entries, which is what keeps `registry[slug]` in
 * `page.tsx` type-safe.
 */
export function sectionsForPage(page?: string) {
  const entry = pages.find((p) => p.slug === page) ?? pages[0];
  const mine = new Set<string>(entry.sections);
  // Only the home page adopts orphans, or a section the agent just added would
  // appear on every page at once.
  const adopts = entry.slug === HOME_PAGE;
  const claimed = claimedSlugs();
  return sections.filter((s) => mine.has(s.slug) || (adopts && !claimed.has(s.slug)));
}

/** Which page shows this section. Used to follow an edit that lands off-screen. */
export function pageForSection(slug: string): string {
  return pages.find((p) => (p.sections as readonly string[]).includes(slug))?.slug ?? HOME_PAGE;
}

export function slugForFile(file: string): string | null {
  return sections.find((s) => s.file === file)?.slug ?? null;
}

export function labelForSlug(slug: string): string | null {
  return sections.find((s) => s.slug === slug)?.label ?? null;
}
