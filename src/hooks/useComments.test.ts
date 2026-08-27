/**
 * The three decisions in the notes hook that aren't just a fetch (§11): which
 * pin a comment is shown on, what the badge counts, and what gets pinned on load
 * because it carries comments. All pure, so all tested without a browser.
 */
import { describe, expect, it } from "vitest";
import type { Comment, ElementRef, SectionInfo } from "@/lib/types";
import {
  bucketNotes,
  countByTarget,
  messageForNotes,
  noteTargetFor,
  targetsWithNotes,
} from "./useComments";

const ref = (over: Partial<ElementRef> = {}): ElementRef => ({
  sectionSlug: "hero",
  path: [0, 1],
  tag: "h1",
  text: "Stay ahead",
  attrs: { id: "headline" },
  nth: 0,
  trail: "section > div > h1",
  label: "Headline",
  ...over,
});

const note = (sectionSlug: string, body: string, target?: { key: string; ref: ElementRef }): Comment => ({
  id: `c-${sectionSlug}-${body}`,
  sectionSlug,
  body,
  status: "open",
  jobId: null,
  createdAt: "2026-01-01T00:00:00Z",
  resolvedAt: null,
  targetKey: target?.key ?? null,
  targetRef: target?.ref ?? null,
  targetLabel: target?.ref.label ?? null,
});

const SECTIONS: SectionInfo[] = [
  { slug: "hero", label: "Hero", file: "sections/hero.tsx" },
  { slug: "features", label: "Features", file: "sections/features.tsx" },
];

const HEADLINE = { key: "hero#0-1", ref: ref() };

describe("bucketNotes", () => {
  it("puts a section comment on the section", () => {
    const buckets = bucketNotes([note("hero", "too tall")], new Set(["hero"]));
    expect([...buckets.keys()]).toEqual(["hero"]);
  });

  it("puts an element comment on the element, when the element is pinned", () => {
    const buckets = bucketNotes([note("hero", "too big", HEADLINE)], new Set(["hero#0-1"]));
    expect([...buckets.keys()]).toEqual(["hero#0-1"]);
  });

  it("falls back to the section when the element is not pinned", () => {
    // What happens after the agent rewrites the section and `downgradePins`
    // turns the element pin into a section pin. Exact-key only would leave the
    // comment counted against a key nothing is pinned at — still sent, but
    // invisible in the composer, which is the one thing a note must never be.
    const buckets = bucketNotes([note("hero", "too big", HEADLINE)], new Set(["hero"]));
    expect([...buckets.keys()]).toEqual(["hero"]);
  });

  it("keeps element and section comments apart while both are pinned", () => {
    const buckets = bucketNotes(
      [note("hero", "too big", HEADLINE), note("hero", "too tall")],
      new Set(["hero", "hero#0-1"]),
    );
    expect(buckets.get("hero#0-1")?.map((c) => c.body)).toEqual(["too big"]);
    expect(buckets.get("hero")?.map((c) => c.body)).toEqual(["too tall"]);
  });

  it("keeps them oldest-first within a bucket", () => {
    const buckets = bucketNotes([note("hero", "a"), note("hero", "b")], new Set(["hero"]));
    expect(buckets.get("hero")?.map((c) => c.body)).toEqual(["a", "b"]);
  });
});

describe("countByTarget", () => {
  it("counts comments per pin", () => {
    const buckets = bucketNotes(
      [note("hero", "a"), note("hero", "b"), note("features", "c")],
      new Set(["hero", "features"]),
    );
    const counts = countByTarget(buckets);
    expect(counts.get("hero")).toBe(2);
    expect(counts.get("features")).toBe(1);
  });

  it("has no entry for a pin with no comments, which the badge reads as 0", () => {
    expect(countByTarget(bucketNotes([], new Set())).get("hero")).toBeUndefined();
  });
});

describe("targetsWithNotes", () => {
  it("brings a section back as a section pin", () => {
    const out = targetsWithNotes([note("features", "a")], SECTIONS);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("features");
    expect(out[0].ref.path).toEqual([]);
  });

  it("brings an element back as the ELEMENT, not as its section", () => {
    // `target_ref` holds enough to re-pin it, so a comment left on a heading
    // yesterday comes back on that heading. If it has gone, the preview reports
    // it and the pin downgrades — the same path an agent rewrite already takes.
    const out = targetsWithNotes([note("hero", "too big", HEADLINE)], SECTIONS);
    expect(out.map((t) => t.key)).toEqual(["hero#0-1"]);
    expect(out[0].ref.label).toBe("Headline");
    expect(out[0].file).toBe("sections/hero.tsx");
    expect(out[0].sectionLabel).toBe("Hero");
  });

  it("pins each thing once however many comments it has", () => {
    const out = targetsWithNotes([note("hero", "a"), note("hero", "b")], SECTIONS);
    expect(out).toHaveLength(1);
  });

  it("pins the element and its section separately when both carry comments", () => {
    const out = targetsWithNotes([note("hero", "a"), note("hero", "b", HEADLINE)], SECTIONS);
    expect(out.map((t) => t.key)).toEqual(["hero", "hero#0-1"]);
  });

  it("orders by the page, not by when the comments were written", () => {
    // The chips should read the way the page reads. Comments arrive oldest-first,
    // which is a different order entirely.
    const out = targetsWithNotes([note("features", "a"), note("hero", "b")], SECTIONS);
    expect(out.map((t) => t.sectionSlug)).toEqual(["hero", "features"]);
  });

  it("skips a slug the studio has not heard of yet", () => {
    // The notes query can settle before the preview reports `ready`. Pinning a
    // slug with no label or file would put an unnamed chip in the composer.
    expect(targetsWithNotes([note("pricing", "a")], SECTIONS)).toEqual([]);
  });

  it("returns nothing when the section list is empty", () => {
    expect(targetsWithNotes([note("hero", "a")], [])).toEqual([]);
  });
});

describe("noteTargetFor", () => {
  it("sends no target for a whole-section pin", () => {
    // `target_key IS NULL` ⇔ a section comment is the one invariant the column
    // rests on, and a whole-section ref's key is already the bare slug.
    const pin = targetsWithNotes([note("hero", "a")], SECTIONS)[0];
    expect(noteTargetFor(pin)).toBeUndefined();
  });

  it("sends the element without its attrs", () => {
    // Same rule the chat route follows: nothing downstream renders `attrs`, so
    // sending them would only widen what ends up in the database.
    const pin = targetsWithNotes([note("hero", "a", HEADLINE)], SECTIONS)[0];
    const target = noteTargetFor(pin);
    expect(target?.key).toBe("hero#0-1");
    expect(target?.label).toBe("Headline");
    expect(target?.ref).not.toHaveProperty("attrs");
    expect(target?.ref.path).toEqual([0, 1]);
  });
});

describe("messageForNotes", () => {
  it("turns an empty composer with notes on it into a real request", () => {
    // The bug this closes: notes on the chips, nothing typed, send disabled —
    // so no job was ever queued and the studio looked like it had ignored you.
    expect(messageForNotes(1)).toContain("note");
    expect(messageForNotes(4)).toContain("all of them");
  });

  it("says nothing when there are no notes", () => {
    // What keeps a genuinely empty composer a no-op rather than a turn about
    // nothing.
    expect(messageForNotes(0)).toBe("");
  });
});
