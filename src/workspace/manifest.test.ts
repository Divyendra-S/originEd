/**
 * The rules of the page split (§10), asserted against the REAL manifest.
 *
 * Deliberately not "landing holds hero and features" — that is the current
 * content, and a test that fails when someone regroups their own site is a test
 * that teaches people to delete tests. What is asserted here is what has to hold
 * for ANY grouping: every section is reachable from exactly one page, an unknown
 * page slug still renders something, and the two directions agree.
 */
import { describe, expect, it } from "vitest";
import { HOME_PAGE, pageForSection, pages, sections, sectionsForPage } from "./manifest";

describe("pages", () => {
  it("has at least one, and the first is the home page", () => {
    // `HOME_PAGE` is what the studio opens on and where an unclaimed section
    // lands. A `pages` array that could be empty would make both undefined.
    expect(pages.length).toBeGreaterThan(0);
    expect(HOME_PAGE).toBe(pages[0].slug);
  });

  it("names each section at most once", () => {
    const named = pages.flatMap((p) => [...p.sections]);
    expect(new Set(named).size).toBe(named.length);
  });
});

describe("sectionsForPage", () => {
  it("shows every section exactly once across all pages", () => {
    // The point of the split is that nothing is hidden and nothing is doubled:
    // switching through the pages has to show you the whole site.
    const shown = pages.flatMap((p) => sectionsForPage(p.slug).map((s) => s.slug));
    expect([...shown].sort()).toEqual(sections.map((s) => s.slug).sort());
  });

  it("renders in manifest order, not in the order the page lists them", () => {
    const order = sections.map((s) => s.slug);
    for (const page of pages) {
      const shown = sectionsForPage(page.slug).map((s) => s.slug);
      expect(shown).toEqual(order.filter((slug) => shown.includes(slug)));
    }
  });

  it("falls back to the home page rather than rendering nothing", () => {
    // A hand-typed `?page=`, or a page the agent has just deleted. A blank frame
    // with no way back is the one answer that leaves the user stuck.
    const home = sectionsForPage(HOME_PAGE);
    expect(sectionsForPage("no-such-page")).toEqual(home);
    expect(sectionsForPage(undefined)).toEqual(home);
    expect(home.length).toBeGreaterThan(0);
  });
});

describe("pageForSection", () => {
  it("points at a page that actually shows the section", () => {
    for (const section of sections) {
      const page = pageForSection(section.slug);
      expect(sectionsForPage(page).map((s) => s.slug)).toContain(section.slug);
    }
  });

  it("sends a section no page claims to the home page", () => {
    // Which is what `add_section` produces: it writes a `{ slug, label, file }`
    // line into `sections` and knows nothing about `pages`.
    expect(pageForSection("a-section-that-does-not-exist")).toBe(HOME_PAGE);
  });
});
