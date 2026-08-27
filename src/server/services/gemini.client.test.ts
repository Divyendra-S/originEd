/**
 * `mergeParts` is two rules pulling against each other: coalesce streamed text
 * fragments (§6.2), but never absorb a part that carries a `thoughtSignature`.
 *
 * The second rule is enforced by the API, not by taste — echoing a functionCall
 * back without its signature returns
 * `400 Function call is missing a thought_signature in functionCall parts`,
 * which kills the job on the turn AFTER the mistake. Verified live.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * The failure `fetch` has no answer for: the request connects, the endpoint says
 * nothing, and the job hangs until somebody presses Stop. Measured on a real
 * one — `status: running`, then 2m24s of silence — with the serial queue parked
 * behind it, so the whole studio stops answering.
 */
describe("streamTurn gives up on a connection that goes quiet", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** A real fetch errors its body when the signal aborts; so does this one. */
  function silentEndpoint() {
    return vi.fn((_url: string, init: RequestInit) => {
      const signal = init.signal!;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
  }

  it("fails with a GeminiError instead of hanging", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_STALL_MS", "40");
    vi.resetModules();
    const { streamTurn, GeminiError } = await import("./gemini.client");
    vi.stubGlobal("fetch", silentEndpoint());

    const job = new AbortController();
    const turn = streamTurn({
      contents: [],
      system: "",
      tools: [],
      signal: job.signal,
      onText: () => {},
    });

    await expect(turn).rejects.toBeInstanceOf(GeminiError);
    await expect(turn).rejects.toThrow("sent nothing for");
    // The JOB's signal is untouched, which is what stops `agent.service` from
    // normalising this into `Cancelled` and reporting a stall as "you stopped it".
    expect(job.signal.aborted).toBe(false);
  });

  it("still lets the caller cancel", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_STALL_MS", "10000");
    vi.resetModules();
    const { streamTurn } = await import("./gemini.client");
    vi.stubGlobal("fetch", silentEndpoint());

    const job = new AbortController();
    const turn = streamTurn({
      contents: [],
      system: "",
      tools: [],
      signal: job.signal,
      onText: () => {},
    });
    job.abort();
    await expect(turn).rejects.toBeDefined();
  });
});
