/**
 * `mergeParts` is two rules pulling against each other: coalesce streamed text
 * fragments (§6.2), but never absorb a part that carries a `thoughtSignature`.
 *
 * The second rule is enforced by the API, not by taste — echoing a functionCall
 * back without its signature returns
 * `400 Function call is missing a thought_signature in functionCall parts`,
 * which kills the job on the turn AFTER the mistake. Verified live.
 */
import { describe, expect, it } from "vitest";
import { mergeParts, type Part } from "./gemini.client";

describe("mergeParts", () => {
  it("coalesces consecutive text fragments into one part", () => {
    const parts: Part[] = [{ text: "Look" }, { text: "ing at " }, { text: "Hero." }];
    expect(mergeParts(parts)).toEqual([{ text: "Looking at Hero." }]);
  });

  it("keeps a functionCall's thoughtSignature attached to it", () => {
    const call: Part = { functionCall: { name: "read_file", args: { path: "a.tsx" } }, thoughtSignature: "SIG" };
    expect(mergeParts([{ text: "one moment " }, call])).toEqual([{ text: "one moment " }, call]);
  });

  it("never merges a signature-bearing text part away", () => {
    const merged = mergeParts([{ text: "before " }, { text: "after", thoughtSignature: "SIG" }]);
    expect(merged).toEqual([{ text: "before " }, { text: "after", thoughtSignature: "SIG" }]);
    expect(merged.find((p) => p.thoughtSignature)).toBeDefined();
  });

  it("merges fragments that follow a signature-bearing part into that part", () => {
    // The signature stays on the part it was issued for; only the tail joins it.
    const merged = mergeParts([{ text: "a", thoughtSignature: "SIG" }, { text: "b" }, { text: "c" }]);
    expect(merged).toEqual([{ text: "abc", thoughtSignature: "SIG" }]);
  });

  it("does not merge text across a functionCall boundary", () => {
    const merged = mergeParts([
      { text: "first " },
      { functionCall: { name: "read_file", args: {} }, thoughtSignature: "S1" },
      { text: "second" },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual({ text: "first " });
    expect(merged[2]).toEqual({ text: "second" });
  });

  it("keeps several functionCalls as separate parts, each with its own signature", () => {
    const merged = mergeParts([
      { functionCall: { name: "read_file", args: { path: "a" } }, thoughtSignature: "S1" },
      { functionCall: { name: "read_file", args: { path: "b" } }, thoughtSignature: "S2" },
    ]);
    expect(merged.map((p) => p.thoughtSignature)).toEqual(["S1", "S2"]);
  });

  it("drops thought summaries — they are not ours to echo back", () => {
    expect(mergeParts([{ text: "reasoning...", thought: true }, { text: "answer" }])).toEqual([{ text: "answer" }]);
  });

  it("copies parts rather than mutating the caller's array", () => {
    const input: Part[] = [{ text: "a" }, { text: "b" }];
    mergeParts(input);
    expect(input).toEqual([{ text: "a" }, { text: "b" }]);
  });

  it("returns an empty array for an empty turn", () => {
    expect(mergeParts([])).toEqual([]);
  });
});
