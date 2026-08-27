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
] as const satisfies readonly SectionEntry[];

export type SectionSlug = (typeof sections)[number]["slug"];

export function slugForFile(file: string): string | null {
  return sections.find((s) => s.file === file)?.slug ?? null;
}

export function labelForSlug(slug: string): string | null {
  return sections.find((s) => s.slug === slug)?.label ?? null;
}
