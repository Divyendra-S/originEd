// @vitest-environment jsdom
/**
 * The preview's DOM contract (§11), against a real document.
 *
 * The properties worth a suite: a pin marker is a foreign child inside a subtree
 * React owns, so it has to survive that subtree being re-rendered — which happens
 * on every hot reload, i.e. every time the agent lands an edit; `syncPins` has to
 * be idempotent, or the MutationObserver watching for the first property spins on
 * its own writes; and the rail must never be counted as page content, or every
 * element path in the section drifts by one the moment a second pin lands.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ElementRef, PinPayload } from "@/lib/types";
import {
  boundaryFrom,
  clearAttr,
  flashSection,
  pinKeyFrom,
  pinsStale,
  setHover,
  setHoverTarget,
  setSelection,
  syncPins,
} from "./dom";
import { refFor, refKey, sectionRef } from "./target";

const PAGE = `
  <div data-section-slug="hero" data-section-label="Hero" data-section-file="sections/hero.tsx" class="oe-section">
    <h1 id="headline">Original</h1>
    <a id="nav" href="/somewhere">Home</a>
  </div>
  <div data-section-slug="features" data-section-label="Features" data-section-file="sections/features.tsx" class="oe-section">
    <p id="blurb">How it works</p>
  </div>
`;

const boundary = (slug: string) => document.querySelector<HTMLElement>(`[data-section-slug="${slug}"]`)!;
const marker = (key: string) => document.querySelector(`[data-oe-pin-for="${key}"]`);
const markerCount = () => document.querySelectorAll("[data-oe-pin-for]").length;

/** A whole-section pin. Its key is the bare slug — the hinge of §11. */
function wholePin(slug: string, count = 0): PinPayload {
  const ref = sectionRef(boundary(slug));
  return { key: refKey(ref), ref, count, sectionLabel: ref.label };
}

/** A pin on one element inside a section. */
function elementPin(slug: string, selector: string, count = 0): PinPayload {
  const b = boundary(slug);
  const ref: ElementRef = refFor(b, b.querySelector(selector)!);
  return { key: refKey(ref), ref, count, sectionLabel: b.dataset.sectionLabel! };
}

beforeEach(() => {
  document.body.innerHTML = PAGE;
});

describe("boundaryFrom", () => {
  it("resolves a click on deep content up to its section", () => {
    expect(boundaryFrom(document.getElementById("headline"))?.getAttribute("data-section-slug")).toBe("hero");
  });

  it("returns null for a click outside every section", () => {
    expect(boundaryFrom(document.body)).toBeNull();
  });

  it("returns null for a non-element target, like the document itself", () => {
    expect(boundaryFrom(document)).toBeNull();
  });
});

describe("setHover / setHoverTarget / setSelection", () => {
  it("marks exactly one section at a time", () => {
    setHover(document, boundary("hero"));
    setHover(document, boundary("features"));
    expect(document.querySelectorAll("[data-oe-hover]")).toHaveLength(1);
    expect(boundary("features").hasAttribute("data-oe-hover")).toBe(true);
  });

  it("tracks the element and the section independently", () => {
    // They are two different outlines: the section tints, the element outlines.
    // Sharing one attribute would make the section flash on every pointer move.
    setHover(document, boundary("hero"));
    setHoverTarget(document, document.getElementById("headline"));
    expect(boundary("hero").hasAttribute("data-oe-hover")).toBe(true);
    expect(document.getElementById("headline")!.hasAttribute("data-oe-hover-el")).toBe(true);
  });

  it("clears the outline when nothing is selected", () => {
    setSelection(document, "hero");
    setSelection(document, null);
    expect(document.querySelectorAll("[data-oe-selected]")).toHaveLength(0);
  });

  it("ignores a slug that is not on the page", () => {
    setSelection(document, "pricing");
    expect(document.querySelectorAll("[data-oe-selected]")).toHaveLength(0);
  });

  it("clearAttr strips the attribute everywhere it landed", () => {
    boundary("hero").setAttribute("data-oe-pinned", "");
    boundary("features").setAttribute("data-oe-pinned", "");
    clearAttr(document, "data-oe-pinned");
    expect(document.querySelectorAll("[data-oe-pinned]")).toHaveLength(0);
  });
});

describe("pinKeyFrom", () => {
  it("reads the key off the marker a click landed inside", () => {
    syncPins(document, [wholePin("hero")]);
    const glyph = marker("hero")!.querySelector(".oe-pin-dot")!;
    expect(pinKeyFrom(glyph)).toBe("hero");
  });

  it("returns null for a click on the page itself", () => {
    syncPins(document, [wholePin("hero")]);
    expect(pinKeyFrom(document.getElementById("headline"))).toBeNull();
  });
});

describe("syncPins", () => {
  it("marks a whole-section pin on the boundary", () => {
    syncPins(document, [wholePin("hero")]);
    expect(boundary("hero").hasAttribute("data-oe-pinned")).toBe(true);
    expect(marker("hero")!.textContent).toContain("Hero");
  });

  it("outlines the ELEMENT for an element pin, and not the whole section", () => {
    const pin = elementPin("hero", "#headline");
    syncPins(document, [pin]);
    expect(document.getElementById("headline")!.hasAttribute("data-oe-target")).toBe(true);
    // The section border is reserved for "the whole section is pinned". Drawing
    // both would make an element pin indistinguishable from a section pin.
    expect(boundary("hero").hasAttribute("data-oe-pinned")).toBe(false);
    expect(marker(pin.key)!.textContent).toContain("Hero › Original");
  });

  it("collects every pin in a section into one rail", () => {
    syncPins(document, [wholePin("hero"), elementPin("hero", "#headline"), elementPin("hero", "#nav")]);
    const rails = boundary("hero").querySelectorAll(":scope > .oe-pin-rail");
    expect(rails).toHaveLength(1);
    expect(rails[0].children).toHaveLength(3);
  });

  it("keeps the rail out of the page's own index space", () => {
    // The bug the whole `data-oe-chrome` attribute exists to prevent: the rail
    // is an element child of the boundary, so a ref taken after it appears must
    // still have the path it had before.
    const before = refFor(boundary("hero"), document.getElementById("nav")!);
    syncPins(document, [wholePin("hero")]);
    expect(refFor(boundary("hero"), document.getElementById("nav")!).path).toEqual(before.path);
  });

  it("is idempotent — the same marker element, not a replacement", () => {
    const pins = [wholePin("hero")];
    syncPins(document, pins);
    const first = marker("hero");
    syncPins(document, pins);
    expect(marker("hero")).toBe(first);
    expect(markerCount()).toBe(1);
  });

  it("removes a marker whose pin is gone, and the empty rail with it", () => {
    syncPins(document, [wholePin("hero"), wholePin("features")]);
    syncPins(document, [wholePin("features")]);
    expect(marker("hero")).toBeNull();
    expect(boundary("hero").querySelector(".oe-pin-rail")).toBeNull();
    expect(markerCount()).toBe(1);
  });

  it("renders a count badge only when there are notes", () => {
    syncPins(document, [wholePin("hero", 2), wholePin("features", 0)]);
    expect(marker("hero")!.querySelector(".oe-pin-count")!.textContent).toBe("2");
    expect(marker("features")!.querySelector(".oe-pin-count")!.textContent).toBe("");
    expect(marker("hero")!.hasAttribute("data-oe-notes")).toBe(true);
    expect(marker("features")!.hasAttribute("data-oe-notes")).toBe(false);
  });

  it("skips a pin whose section is not on the page", () => {
    const pin = wholePin("hero");
    syncPins(document, [pin]);
    document.body.innerHTML = PAGE; // the agent deleted and rebuilt the page
    expect(() => syncPins(document, [pin])).not.toThrow();
  });

  it("reports an element it can no longer find, without dropping the marker", () => {
    const pin = elementPin("hero", "#headline");
    document.getElementById("headline")!.remove();
    const unresolved = syncPins(document, [pin]);
    expect(unresolved).toEqual([pin.key]);
    // The marker stays: silently deleting the pin would take away context the
    // user still believes they attached. The studio downgrades it instead.
    expect(marker(pin.key)!.hasAttribute("data-oe-lost")).toBe(true);
  });

  it("does not report a section pin as unresolved, ever", () => {
    // A missing section is a different failure with a different owner —
    // `reconcilePins` studio-side, on the section list the preview reports.
    const pin = wholePin("hero");
    syncPins(document, [pin]);
    document.querySelector('[data-section-slug="hero"]')!.remove();
    expect(syncPins(document, [pin])).toEqual([]);
  });

  it("re-attaches after the section is re-rendered, which is what a hot reload is", () => {
    const pin = elementPin("hero", "#headline");
    syncPins(document, [pin]);
    boundary("hero").innerHTML = `<h1 id="headline">Original</h1><a id="nav" href="/somewhere">Home</a>`;
    expect(marker(pin.key)).toBeNull();
    syncPins(document, [pin]);
    expect(marker(pin.key)).not.toBeNull();
    expect(document.getElementById("headline")!.hasAttribute("data-oe-target")).toBe(true);
  });
});

describe("pinsStale", () => {
  it("is false right after a sync", () => {
    const pins = [wholePin("hero"), elementPin("features", "#blurb")];
    syncPins(document, pins);
    expect(pinsStale(document, pins)).toBe(false);
  });

  it("is true when a re-render took the marker away", () => {
    const pins = [wholePin("hero")];
    syncPins(document, pins);
    boundary("hero").innerHTML = "<h1 id='headline'>Original</h1>";
    expect(pinsStale(document, pins)).toBe(true);
  });

  it("is true when the marker survived but the element outline did not", () => {
    const pins = [elementPin("hero", "#headline")];
    syncPins(document, pins);
    document.getElementById("headline")!.removeAttribute("data-oe-target");
    expect(pinsStale(document, pins)).toBe(true);
  });

  it("stays false for a pin already known to be unresolvable", () => {
    // Otherwise a genuinely deleted element reads as "missing" on every single
    // mutation and the observer resyncs the whole page forever.
    const pin = elementPin("hero", "#headline");
    document.getElementById("headline")!.remove();
    const unresolved = syncPins(document, [pin]);
    expect(pinsStale(document, [pin], unresolved)).toBe(false);
  });

  it("ignores a pin whose section is not on the page", () => {
    const pin = wholePin("hero");
    document.querySelector('[data-section-slug="hero"]')!.remove();
    expect(pinsStale(document, [pin])).toBe(false);
  });
});

describe("flashSection", () => {
  it("marks the section and reports that it found it", () => {
    expect(flashSection(document, "hero")).toBe(true);
    expect(boundary("hero").hasAttribute("data-oe-flash")).toBe(true);
  });

  it("reports false for a section that is not on the page", () => {
    expect(flashSection(document, "pricing")).toBe(false);
  });
});
