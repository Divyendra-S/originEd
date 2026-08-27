// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  CHROME,
  chainFor,
  selectableIn,
  contentText,
  labelFor,
  meaningfulFrom,
  refFor,
  refKey,
  resolveRef,
  sectionRef,
  signatureScore,
} from "./target";

/**
 * Modelled on the real page rather than invented: the hero's form-with-icon-button
 * and the features grid's three identical cards are the two shapes that actually
 * decide whether this works. The cards come from `{ITEMS.map(...)}` in
 * `sections/features.tsx`, which is the case with no single JSX node behind it.
 */
const PAGE = `
<div data-section-slug="hero" data-section-label="Hero" data-section-file="sections/hero.tsx" class="oe-section relative">
  <section>
    <div class="wrap">
      <div class="only"><h1 class="text-6xl">Stay ahead of the bezier curve</h1></div>
      <p class="lead">Build faster.</p>
      <form>
        <input type="email" placeholder="you@work.com" />
        <button type="button">Learn more</button>
        <button type="submit"><svg viewBox="0 0 12 12"><path d="M1 1"></path></svg><span>Get started</span></button>
      </form>
      <div aria-hidden="true" class="glow"></div>
      <img src="/a.png" alt="Avatar" />
    </div>
  </section>
</div>
<div data-section-slug="features" data-section-label="Features" data-section-file="sections/features.tsx" class="oe-section relative">
  <section>
    <div class="wrap">
      <p class="kicker">How it works</p>
      <h2>Point at the page.</h2>
      <div class="grid">
        <div class="card"><span class="num">01</span><h3>Point at it</h3><p>Switch the preview.</p></div>
        <div class="card"><span class="num">02</span><h3>Say what you want</h3><p>Plain sentences.</p></div>
        <div class="card"><span class="num">03</span><h3>Keep what works</h3><p>Every write is recorded.</p></div>
      </div>
    </div>
  </section>
</div>`;

const boundary = (slug: string) =>
  document.querySelector<HTMLElement>(`[data-section-slug="${slug}"]`)!;
const one = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;

beforeEach(() => {
  document.body.innerHTML = PAGE;
});

describe("refKey", () => {
  it("keys a whole-section ref to the bare slug", () => {
    // The hinge the entire migration turns on: every `pin_click`, every
    // `comments.section_slug` row and every existing test fixture keeps meaning
    // what it meant, with no translation layer, because of this one identity.
    expect(refKey(sectionRef(boundary("hero")))).toBe("hero");
  });

  it("keys an element ref to slug + path", () => {
    const ref = refFor(boundary("hero"), one("h1"));
    expect(refKey(ref)).toBe(`hero#${ref.path.join("-")}`);
    expect(refKey(ref)).not.toBe("hero");
  });
});

describe("refFor / resolveRef round trip", () => {
  const cases: [string, string][] = [
    ["a heading", "h1"],
    ["a paragraph", ".lead"],
    ["a button", 'button[type="submit"]'],
    ["an input", 'input[type="email"]'],
    ["an image", "img"],
    ["a nested span", 'button[type="submit"] span'],
    ["a card in a map", ".card:nth-of-type(2) h3"],
  ];

  for (const [what, sel] of cases) {
    it(`finds ${what} again`, () => {
      const b = boundary(sel.startsWith(".card") || sel === ".kicker" ? "features" : "hero");
      const el = b.querySelector(sel)!;
      const found = resolveRef(b, refFor(b, el));
      expect(found?.el).toBe(el);
      expect(found?.how).toBe("path");
    });
  }

  it("round trips the boundary itself", () => {
    const b = boundary("hero");
    expect(resolveRef(b, refFor(b, b))?.el).toBe(b);
  });
});

describe("tool chrome never contaminates a ref", () => {
  /**
   * The bug this whole attribute exists to prevent. A marker is an element child
   * of the boundary, so if it were counted, every path in the section would shift
   * by one the first time a second pin landed there — silently, intermittently,
   * and looking for all the world like a flaky matcher.
   */
  const addMarker = (slug: string) => {
    const rail = document.createElement("div");
    rail.setAttribute(CHROME, "");
    rail.className = "oe-pin-rail";
    rail.textContent = "Hero";
    boundary(slug).prepend(rail); // prepended: worst case for index drift
    return rail;
  };

  it("gives the same path before and after a marker appears", () => {
    const b = boundary("hero");
    const before = refFor(b, one("h1"));
    addMarker("hero");
    expect(refFor(b, one("h1")).path).toEqual(before.path);
  });

  it("still resolves through a marker", () => {
    const b = boundary("hero");
    const ref = refFor(b, one("h1"));
    addMarker("hero");
    expect(resolveRef(b, ref)?.el).toBe(one("h1"));
  });

  it("keeps the marker's own label out of the section's text", () => {
    addMarker("hero");
    expect(contentText(boundary("hero"))).not.toContain("Hero");
    expect(contentText(boundary("hero"))).toContain("Stay ahead");
  });
});

describe("resolveRef degrades in the right order", () => {
  it("falls back to the signature when the path breaks", () => {
    const b = boundary("hero");
    const ref = refFor(b, one("h1"));
    // A new first child shifts every index after it.
    b.querySelector("section")!.prepend(document.createElement("aside"));
    const found = resolveRef(b, ref);
    expect(found?.el).toBe(one("h1"));
    expect(found?.how).toBe("signature");
  });

  it("survives a total restyle, because class is not part of a signature", () => {
    const b = boundary("hero");
    const ref = refFor(b, one("h1"));
    b.querySelector("section")!.prepend(document.createElement("aside"));
    b.querySelectorAll("*").forEach((el) => el.setAttribute("class", "totally-different"));
    expect(resolveRef(b, ref)?.el).toBe(one("h1"));
  });

  it("keeps a pin whose text the agent just rewrote", () => {
    // The most ordinary request there is: pin the headline, ask for new words.
    // Remembering it by text alone would delete the pin at the exact moment the
    // user is looking at the result.
    const b = boundary("hero");
    const ref = refFor(b, one("h1"));
    one("h1").textContent = "Something else entirely";
    const found = resolveRef(b, ref);
    expect(found?.el).toBe(one("h1"));
    expect(found?.how).toBe("path");
  });

  it("finds it by id when both the path and the text are gone", () => {
    const b = boundary("hero");
    one("h1").setAttribute("id", "headline");
    const ref = refFor(b, one("h1"));
    b.querySelector("section")!.prepend(document.createElement("aside"));
    one("h1").textContent = "Something else entirely";
    expect(resolveRef(b, ref)?.how).toBe("signature");
  });

  it("gives up when the tag is right but nothing else is", () => {
    const b = boundary("features");
    const ref = refFor(b, one(".card:nth-of-type(2) h3"));
    b.querySelector(".grid")!.prepend(document.createElement("aside"));
    b.querySelectorAll("h3").forEach((h) => (h.textContent = "unrecognisable"));
    // tag(4) + nth(1) = 5, under SCAN_MIN. Guessing here would silently move the
    // pin to a different card, which is worse than admitting it is lost.
    expect(resolveRef(b, ref)).toBeNull();
  });

  it("returns null when the element is deleted outright", () => {
    const b = boundary("hero");
    const ref = refFor(b, one("h1"));
    one("h1").remove();
    expect(resolveRef(b, ref)).toBeNull();
  });

  it("tells two identical siblings apart by position", () => {
    const b = boundary("hero");
    const buttons = b.querySelectorAll("button");
    buttons[0].textContent = "Learn more";
    buttons[1].textContent = "Learn more";
    const ref = refFor(b, buttons[1]);
    expect(resolveRef(b, ref)?.el).toBe(buttons[1]);
  });
});

describe("signatureScore", () => {
  it("scores zero across different tags, whatever else matches", () => {
    const b = boundary("hero");
    const ref = refFor(b, one("h1"));
    const p = one(".lead");
    p.textContent = "Stay ahead of the bezier curve";
    expect(signatureScore(ref, p)).toBe(0);
  });

  it("rewards an id more than any other attribute", () => {
    const b = boundary("hero");
    one("h1").setAttribute("id", "headline");
    const ref = refFor(b, one("h1"));
    const other = document.createElement("h1");
    other.setAttribute("id", "headline");
    b.appendChild(other);
    expect(signatureScore(ref, other)).toBeGreaterThanOrEqual(8);
  });
});

describe("meaningfulFrom", () => {
  it("climbs out of a span that only carries a class", () => {
    const b = boundary("hero");
    const span = one('button[type="submit"] span');
    expect(meaningfulFrom(b, span)).toBe(one('button[type="submit"]'));
  });

  it("climbs out of an icon to the control around it", () => {
    const b = boundary("hero");
    expect(meaningfulFrom(b, one("svg path"))).toBe(one('button[type="submit"]'));
  });

  it("selects a standalone span rather than climbing past it", () => {
    // `span` is not a semantic atom, but `01` in a feature card is a real thing
    // to point at. Substance, not tag name, is what decides.
    const b = boundary("features");
    const num = b.querySelector(".num")!;
    expect(meaningfulFrom(b, num)).toBe(num);
  });

  it("passes straight through a decorative overlay", () => {
    const b = boundary("hero");
    // It has no text, so selection climbs past it to the nearest ancestor that
    // does — never stopping on the overlay itself.
    expect(meaningfulFrom(b, one(".glow"))).toBe(one(".wrap"));
  });

  it("selects an image, which has no text at all", () => {
    const b = boundary("hero");
    expect(meaningfulFrom(b, one("img"))).toBe(one("img"));
  });

  it("returns the boundary for a click on the section itself", () => {
    const b = boundary("hero");
    expect(meaningfulFrom(b, b)).toBe(b);
  });
});

describe("chainFor", () => {
  it("never exceeds three rungs and always ends at the section", () => {
    const b = boundary("features");
    const chain = chainFor(b, one(".card:nth-of-type(2) h3"));
    expect(chain.length).toBeLessThanOrEqual(3);
    expect(chain.at(-1)).toBe(b);
    expect(chain[0]).toBe(one(".card:nth-of-type(2) h3"));
  });

  it("puts the card between the heading and the section", () => {
    const b = boundary("features");
    const chain = chainFor(b, one(".card:nth-of-type(2) h3"));
    expect(chain[1]).toBe(one(".card:nth-of-type(2)"));
  });

  it("collapses a wrapper that repeats its only child", () => {
    // <div class="only"><h1>…</h1></div> is one thing wearing two hats. Counting
    // it would spend a click arriving back where the user already was.
    const b = boundary("hero");
    const chain = chainFor(b, one("h1"));
    expect(chain).not.toContain(one(".only"));
  });

  it("is a single rung for a click on the section background", () => {
    const b = boundary("hero");
    expect(chainFor(b, b)).toEqual([b]);
  });
});

describe("labelFor", () => {
  it.each([
    ["h1", "Stay ahead of the bezie…"],
    ['button[type="submit"]', "Get started"],
    ["img", "Image “Avatar”"],
    ['input[type="email"]', "you@work.com"],
    [".glow", "Block"],
  ])("names %s", (sel, expected) => {
    expect(labelFor(one(sel))).toBe(expected);
  });

  it("names a container with several children a card", () => {
    expect(labelFor(one(".grid"))).toBe("01 Point at it Switch t…");
  });
});

describe("refFor captures what the prompt needs", () => {
  it("records the trail, the text and the position of a mapped card", () => {
    const b = boundary("features");
    const ref = refFor(b, one(".card:nth-of-type(2) h3"));
    expect(ref.tag).toBe("h3");
    expect(ref.text).toBe("Say what you want");
    expect(ref.trail).toContain("h3");
    expect(ref.label).toBe("Say what you want");
  });

  it("keeps class out of attrs and identifying attributes in", () => {
    const b = boundary("hero");
    const ref = refFor(b, one('input[type="email"]'));
    expect(ref.attrs).toMatchObject({ type: "email" });
    expect(ref.attrs).not.toHaveProperty("class");
  });
});

describe("selectableIn", () => {
  const ids = (b: HTMLElement) => selectableIn(b).map((el) => el.tagName.toLowerCase());

  it("offers the control, never the icon or the span inside it", () => {
    // The decisive exclusion. A marquee that returned the <svg> inside a button
    // would hand the agent "the icon in the button" when the user drew a box
    // around the button.
    const b = boundary("hero");
    const found = selectableIn(b);
    expect(found).toContain(one('button[type="submit"]'));
    expect(found).not.toContain(one('button[type="submit"] span'));
    expect(found).not.toContain(one("svg"));
  });

  it("leaves out a decorative overlay with no text", () => {
    expect(selectableIn(boundary("hero"))).not.toContain(one(".glow"));
  });

  it("keeps replaced elements, which are exactly what people point at", () => {
    const b = boundary("hero");
    expect(selectableIn(b)).toContain(one("img"));
    expect(selectableIn(b)).toContain(one('input[type="email"]'));
  });

  it("returns document order, so a drag reads top to bottom", () => {
    const b = boundary("features");
    expect(ids(b).slice(0, 4)).toEqual(["section", "div", "p", "h2"]);
  });

  it("never offers the tool's own chrome", () => {
    const b = boundary("hero");
    const rail = document.createElement("div");
    rail.setAttribute(CHROME, "");
    rail.innerHTML = "<button>Hero</button>";
    b.appendChild(rail);
    const found = selectableIn(b);
    expect(found).not.toContain(rail);
    expect(found.some((el) => el.textContent === "Hero" && el.tagName === "BUTTON")).toBe(false);
  });
});
