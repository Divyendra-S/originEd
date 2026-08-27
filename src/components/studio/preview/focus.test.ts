import { describe, expect, it } from "vitest";
import { livePage, previewSrc } from "./focus";

const PAGES = [
  { slug: "landing", label: "Landing" },
  { slug: "hero-08", label: "Hero 08" },
];

describe("previewSrc", () => {
  it("names the page", () => {
    expect(previewSrc("hero-08")).toBe("/preview?page=hero-08");
  });

  it("encodes a slug rather than trusting it", () => {
    // Page slugs come out of `manifest.ts`, which the agent writes.
    expect(previewSrc("a b&c")).toBe("/preview?page=a%20b%26c");
  });
});

describe("livePage", () => {
  it("keeps a page the manifest still has", () => {
    expect(livePage("hero-08", PAGES)).toBe("hero-08");
  });

  it("falls back to the first page when the one being viewed is gone", () => {
    // The agent deleted the page the user was looking at.
    expect(livePage("pricing", PAGES)).toBe("landing");
  });

  it("leaves the page alone when there is no list to check against", () => {
    // An empty list is a manifest mid-edit, not a site with no pages.
    expect(livePage("hero-08", [])).toBe("hero-08");
  });
});
