/**
 * The two decisions in the notes hook that aren't just a fetch (§11): what the
 * marker badge counts, and which sections get pinned because they carry notes.
 * Both are pure, so both are tested without a browser.
 */
import { describe, expect, it } from "vitest";
import type { Comment, SectionInfo } from "@/lib/types";
import { countBySection, sectionsWithNotes } from "./useComments";

const note = (sectionSlug: string, body: string): Comment => ({
  id: `c-${sectionSlug}-${body}`,
  sectionSlug,
  body,
  status: "open",
  jobId: null,
  createdAt: "2026-01-01T00:00:00Z",
  resolvedAt: null,
});

const SECTIONS: SectionInfo[] = [
  { slug: "hero", label: "Hero", file: "sections/hero.tsx" },
  { slug: "features", label: "Features", file: "sections/features.tsx" },
];

describe("countBySection", () => {
  it("counts notes per section", () => {
    const counts = countBySection([note("hero", "a"), note("hero", "b"), note("features", "c")]);
    expect(counts.get("hero")).toBe(2);
    expect(counts.get("features")).toBe(1);
  });

  it("has no entry for a section with no notes, which the badge reads as 0", () => {
    expect(countBySection([]).get("hero")).toBeUndefined();
  });
});

describe("sectionsWithNotes", () => {
  it("returns the sections carrying notes, as pin entries", () => {
    const out = sectionsWithNotes([note("features", "a")], SECTIONS);
    expect(out).toEqual([SECTIONS[1]]);
  });

  it("returns each section once however many notes it has", () => {
    const out = sectionsWithNotes([note("hero", "a"), note("hero", "b")], SECTIONS);
    expect(out).toHaveLength(1);
  });

  it("orders by the page, not by when the notes were written", () => {
    // The chips should read the way the page reads. Notes arrive oldest-first,
    // which is a different order entirely.
    const out = sectionsWithNotes([note("features", "a"), note("hero", "b")], SECTIONS);
    expect(out.map((s) => s.slug)).toEqual(["hero", "features"]);
  });

  it("skips a slug the studio has not heard of yet", () => {
    // The notes query can settle before the preview reports `ready`. Pinning a
    // slug with no label or file would put an unnamed chip in the composer.
    expect(sectionsWithNotes([note("pricing", "a")], SECTIONS)).toEqual([]);
  });

  it("returns nothing when the section list is empty", () => {
    expect(sectionsWithNotes([note("hero", "a")], [])).toEqual([]);
  });
});
