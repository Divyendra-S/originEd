/**
 * The pin set's decisions, without a browser. Same approach as
 * `useJobStream.test.ts`: the hook is a `useState` wrapper, the judgement calls
 * are pure functions, and those are what is worth asserting.
 */
import { describe, expect, it } from "vitest";
import type { ElementRef, SectionInfo } from "@/lib/types";
import {
  addPins,
  downgradePins,
  isWholeSection,
  pinLabel,
  reconcilePins,
  removePin,
  toPinPayload,
  togglePin,
  type Pinned,
} from "./usePins";

/** A whole-section pin. Its key IS the slug — the identity §11 rests on. */
function section(slug: string, label: string): Pinned {
  const ref: ElementRef = {
    sectionSlug: slug,
    path: [],
    tag: "",
    text: "",
    attrs: {},
    nth: 0,
    trail: "",
    label,
  };
  return { key: slug, ref, sectionSlug: slug, sectionLabel: label, file: `sections/${slug}.tsx` };
}

/** A pin on one element inside a section. */
function element(slug: string, sectionLabel: string, path: number[], label: string): Pinned {
  const ref: ElementRef = {
    sectionSlug: slug,
    path,
    tag: "h1",
    text: label,
    attrs: {},
    nth: 0,
    trail: `section > ${label}`,
    label,
  };
  return {
    key: `${slug}#${path.join("-")}`,
    ref,
    sectionSlug: slug,
    sectionLabel,
    file: `sections/${slug}.tsx`,
  };
}

const hero = section("hero", "Hero");
const features = section("features", "Features");
const footer = section("footer", "Footer");
const headline = element("hero", "Hero", [0, 1], "Stay ahead");
const cta = element("hero", "Hero", [0, 2], "Get started");

const known: SectionInfo[] = [
  { slug: "hero", label: "Hero", file: "sections/hero.tsx" },
  { slug: "features", label: "Features", file: "sections/features.tsx" },
];

describe("keys", () => {
  it("keys a whole-section pin to the bare slug", () => {
    // Everything downstream — the note counts, `flash`, every existing comments
    // row — keeps working because of this one identity, with no translation.
    expect(hero.key).toBe("hero");
    expect(isWholeSection(hero)).toBe(true);
  });

  it("keys an element pin to slug + path, which can never collide with a slug", () => {
    expect(headline.key).toBe("hero#0-1");
    expect(isWholeSection(headline)).toBe(false);
  });

  it("labels a section by its name and an element by what it says", () => {
    expect(pinLabel(hero)).toBe("Hero");
    expect(pinLabel(headline)).toBe("Stay ahead");
  });
});

describe("togglePin", () => {
  it("pins something that is not pinned yet", () => {
    expect(togglePin([], hero)).toEqual([hero]);
  });

  it("UNPINS on a second click rather than pinning it twice", () => {
    expect(togglePin([hero], hero)).toEqual([]);
  });

  it("matches on key, not identity — the preview sends a fresh object each click", () => {
    expect(togglePin([hero], section("hero", "Hero"))).toEqual([]);
  });

  it("treats an element and its section as two different pins", () => {
    // They are: one ships the file with "change this paragraph", the other ships
    // the file with "change this section". Collapsing them would make clicking a
    // heading inside a pinned section silently unpin the section.
    expect(togglePin([hero], headline)).toEqual([hero, headline]);
  });

  it("keeps pin order stable when unpinning from the middle", () => {
    expect(togglePin([hero, features, footer], features)).toEqual([hero, footer]);
  });
});

describe("removePin", () => {
  it("removes by key", () => {
    expect(removePin([hero, headline], "hero#0-1")).toEqual([hero]);
  });

  it("is a no-op for a key that is not pinned", () => {
    expect(removePin([hero], "pricing")).toEqual([hero]);
  });
});

describe("addPins", () => {
  it("adds what is missing and leaves the rest alone", () => {
    expect(addPins([hero], [hero, headline])).toEqual([hero, headline]);
  });

  it("returns the SAME array when nothing is missing", () => {
    // The effect that calls this runs whenever the notes query settles; a new
    // array each time would push `set_pins` into the preview on every refetch.
    const current = [hero];
    expect(addPins(current, [hero])).toBe(current);
  });

  it("de-dupes within one drag", () => {
    expect(addPins([], [headline, headline, cta])).toEqual([headline, cta]);
  });
});

describe("reconcilePins", () => {
  it("drops pins whose SECTION the agent deleted, elements included", () => {
    expect(reconcilePins([hero, headline, footer], known)).toEqual([hero, headline]);
  });

  it("never unpins on an empty section list", () => {
    // Empty means the preview has not reported yet, not that the page is empty.
    const current = [hero, headline];
    expect(reconcilePins(current, [])).toBe(current);
  });

  it("returns the same array when every pin is still live", () => {
    const current = [hero, headline];
    expect(reconcilePins(current, known)).toBe(current);
  });
});

describe("downgradePins", () => {
  it("turns a lost element into a pin on its section", () => {
    // Not a drop: `snapshot()` sends the whole file either way, so this loses
    // only the "which element" sentence. Dropping would delete context the user
    // still believes is attached, silently.
    const out = downgradePins([headline], ["hero#0-1"]);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("hero");
    expect(out[0].ref.path).toEqual([]);
    expect(pinLabel(out[0])).toBe("Hero");
  });

  it("collapses onto a section that is already pinned instead of duplicating it", () => {
    expect(downgradePins([hero, headline], ["hero#0-1"])).toEqual([hero]);
  });

  it("collapses two lost elements in one section onto one pin", () => {
    const out = downgradePins([headline, cta], ["hero#0-1", "hero#0-2"]);
    expect(out.map((p) => p.key)).toEqual(["hero"]);
  });

  it("returns the SAME array when nothing was lost", () => {
    // The guard against an infinite ping-pong: the preview reports unresolved
    // keys, the studio answers with `set_pins`, which lands back in the preview.
    const current = [hero, headline];
    expect(downgradePins(current, [])).toBe(current);
    expect(downgradePins(current, ["features#0"])).toBe(current);
  });

  it("returns the same array when the lost key is already a section pin", () => {
    const current = [hero];
    expect(downgradePins(current, ["hero"])).toBe(current);
  });
});

describe("toPinPayload", () => {
  it("carries the ref and the section label the marker needs", () => {
    expect(toPinPayload([headline])).toEqual([
      { key: "hero#0-1", ref: headline.ref, count: 0, sectionLabel: "Hero" },
    ]);
  });

  it("attaches note counts by key", () => {
    const counts = new Map([["hero", 3]]);
    expect(toPinPayload([hero, headline], counts).map((p) => p.count)).toEqual([3, 0]);
  });
});
