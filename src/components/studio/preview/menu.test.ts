/**
 * The page switcher's keyboard ring.
 *
 * Worth its own tests because the switcher is now a hand-rolled listbox rather
 * than a native `<select>`: the platform is no longer doing this for us, so the
 * wrap-around is ours to get right.
 */
import { describe, expect, it } from "vitest";
import { nextIndex } from "./menu";

describe("nextIndex", () => {
  it("steps down and up", () => {
    expect(nextIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextIndex("ArrowUp", 2, 3)).toBe(1);
  });

  it("wraps rather than clamping — a short list is a ring", () => {
    expect(nextIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("jumps to the ends", () => {
    expect(nextIndex("Home", 2, 3)).toBe(0);
    expect(nextIndex("End", 0, 3)).toBe(2);
  });

  it("returns null for a key it does not own, so the caller can let it through", () => {
    expect(nextIndex("Enter", 0, 3)).toBeNull();
    expect(nextIndex("a", 0, 3)).toBeNull();
    expect(nextIndex("Tab", 1, 3)).toBeNull();
  });

  it("handles an empty list without producing an index into nothing", () => {
    expect(nextIndex("ArrowDown", 0, 0)).toBeNull();
    expect(nextIndex("Home", 0, 0)).toBeNull();
  });

  it("is stable on a single-entry list", () => {
    expect(nextIndex("ArrowDown", 0, 1)).toBe(0);
    expect(nextIndex("ArrowUp", 0, 1)).toBe(0);
  });
});
