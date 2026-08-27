// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { boxFrom, coverage, pickInBox, type Box } from "./marquee";

const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  right,
  bottom,
});

describe("boxFrom", () => {
  it("normalises a drag made in any direction", () => {
    // Dragging up-and-left is exactly as common as down-and-right, and a box
    // with a negative width silently matches nothing.
    expect(boxFrom(100, 100, 20, 40)).toEqual(box(20, 40, 100, 100));
  });
});

describe("coverage", () => {
  it("is 1 when the element is wholly inside", () => {
    expect(coverage(box(10, 10, 20, 20), box(0, 0, 100, 100))).toBe(1);
  });

  it("is 0 when they only touch", () => {
    expect(coverage(box(0, 0, 10, 10), box(10, 10, 20, 20))).toBe(0);
  });

  it("is a fraction on a partial overlap", () => {
    expect(coverage(box(0, 0, 10, 10), box(5, 0, 100, 10))).toBeCloseTo(0.5);
  });

  it("is 0 for a zero-area element rather than NaN", () => {
    // A display:none element measures 0×0, and 0/0 would poison the comparison.
    expect(coverage(box(5, 5, 5, 5), box(0, 0, 100, 100))).toBe(0);
  });
});

describe("pickInBox", () => {
  let root: HTMLElement;
  const rects = new Map<Element, Box>();
  const rectOf = (el: Element) => rects.get(el) ?? box(0, 0, 0, 0);

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="grid">
        <div id="card1"><h3 id="h1">One</h3><p id="p1">First</p></div>
        <div id="card2"><h3 id="h2">Two</h3><p id="p2">Second</p></div>
      </div>`;
    root = document.getElementById("grid")!;
    rects.clear();
    rects.set(root, box(0, 0, 400, 200));
    rects.set(document.getElementById("card1")!, box(0, 0, 190, 200));
    rects.set(document.getElementById("h1")!, box(10, 10, 180, 40));
    rects.set(document.getElementById("p1")!, box(10, 50, 180, 90));
    rects.set(document.getElementById("card2")!, box(210, 0, 400, 200));
    rects.set(document.getElementById("h2")!, box(220, 10, 390, 40));
    rects.set(document.getElementById("p2")!, box(220, 50, 390, 90));
  });

  const all = () => Array.from(document.querySelectorAll<HTMLElement>("#grid, #grid *"));

  it("returns the outermost thing the box contains, not every descendant", () => {
    // The decisive case: a box drawn around one card contains the card, its
    // heading and its paragraph. Naming all three would ask the agent for the
    // same change at three levels of nesting.
    const picked = pickInBox(all(), box(-5, -5, 195, 205), rectOf);
    expect(picked.map((el) => el.id)).toEqual(["card1"]);
  });

  it("picks the two elements a narrow horizontal drag crosses", () => {
    const picked = pickInBox(all(), box(0, 5, 400, 45), rectOf);
    expect(picked.map((el) => el.id)).toEqual(["h1", "h2"]);
  });

  it("keeps reading order", () => {
    const picked = pickInBox(all(), box(200, 0, 400, 100), rectOf);
    expect(picked.map((el) => el.id)).toEqual(["h2", "p2"]);
  });

  it("ignores an element the box merely clips", () => {
    // 30px of a 170px-wide heading is not a selection of that heading.
    expect(pickInBox(all(), box(0, 10, 40, 40), rectOf)).toEqual([]);
  });

  it("caps the list rather than handing over the whole page", () => {
    expect(pickInBox(all(), box(-50, -50, 500, 500), rectOf, 1)).toHaveLength(1);
  });
});
