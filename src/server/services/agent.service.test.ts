/**
 * The loop (§6). Gemini and the filesystem are both mocked here — what is under
 * test is the control flow that decides when to stop, what to echo back, and
 * what the user sees while it happens.
 *
 * The exit condition gets its own test because it is the one thing §6 warns
 * about: `finishReason` is "STOP" on tool-calling turns too, so branching on it
 * ends the job after the first tool call, every time.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./gemini.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gemini.client")>()),
  streamTurn: vi.fn(),
}));
vi.mock("./agent.tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent.tools")>()),
  execute: vi.fn(),
}));
vi.mock("./agent.prompt", () => ({
  systemPrompt: () => "SYSTEM",
  buildInitialContents: vi.fn(async () => [{ role: "user", parts: [{ text: "PROMPT" }] }]),
}));
// The gate spawns a real compiler over the real jail. Mocked so these tests
// stay hermetic and fast — `typecheck.test.ts` owns the parsing, and the live
// runs own the spawn.
vi.mock("@/server/infra/typecheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/infra/typecheck")>()),
  run: vi.fn(async () => ({ diagnostics: [] })),
}));

import type { Job, JobEventData } from "@/lib/types";
import * as typecheck from "@/server/infra/typecheck";
import * as tools from "./agent.tools";
import { Cancelled, run } from "./agent.service";
import { streamTurn, type TurnResult } from "./gemini.client";

const JOB: Job = {
  id: "job-1",
  chatId: "chat-1",
  status: "running",
  prompt: "make it bigger",
  context: null,
  error: null,
  createdAt: "2026-01-01T00:00:00Z",
  startedAt: null,
  finishedAt: null,
};

/** A turn the mocked client will "stream": text fragments, then parts. */
function turn(over: Partial<TurnResult> & { fragments?: string[] } = {}) {
  const { fragments = [], ...rest } = over;
  const result: TurnResult = {
    parts: [],
    calls: [],
    text: fragments.join(""),
    usage: { promptTokenCount: 10, candidatesTokenCount: 5 },
    finishReason: "STOP",
    ...rest,
  };
  return { result, fragments };
}

function plan(...turns: ReturnType<typeof turn>[]) {
  const mock = vi.mocked(streamTurn);
  mock.mockReset();
  for (const t of turns) {
    mock.mockImplementationOnce(async (input) => {
      for (const f of t.fragments) await input.onText(f);
      return t.result;
    });
  }
  return mock;
}

function harness(signal = new AbortController().signal) {
  const events: JobEventData[] = [];
  return {
    events,
    ctx: { job: JOB, signal, emit: async (d: JobEventData) => void events.push(d) },
    deltas: () => events.filter((e) => e.type === "text_delta").map((e) => e.text).join(""),
    typed: <T extends JobEventData["type"]>(type: T) =>
      events.filter((e): e is Extract<JobEventData, { type: T }> => e.type === type),
  };
}

const call = (name: string, args: Record<string, unknown> = {}, id?: string) => ({ name, args, id });

const okOutcome = (over: Partial<tools.ToolOutcome> = {}): tools.ToolOutcome => ({
  ok: true,
  summary: "did the thing",
  payload: { ok: true },
  ...over,
});

const diagnostic = (over: Partial<typecheck.Diagnostic> = {}): typecheck.Diagnostic => ({
  path: "sections/hero.tsx",
  line: 12,
  column: 5,
  code: "TS2304",
  message: "Cannot find name 'foo'.",
  ...over,
});

/** A tool call that reports a write, so the gate has a reason to run. */
const wroteHero = okOutcome({
  changes: [{ type: "file_changed", path: "sections/hero.tsx", op: "update", sectionSlug: "hero" }],
});

beforeEach(() => {
  vi.mocked(tools.execute).mockReset();
  vi.mocked(tools.execute).mockResolvedValue(okOutcome());
  vi.mocked(typecheck.run).mockReset();
  vi.mocked(typecheck.run).mockResolvedValue({ diagnostics: [] });
});

describe("exit condition", () => {
  it("stops on a turn with no functionCall, NOT on finishReason", async () => {
    plan(turn({ fragments: ["all done"], parts: [{ text: "all done" }], finishReason: "STOP" }));
    const h = harness();
    const result = await run(h.ctx);
    expect(streamTurn).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("all done");
  });

  it("keeps going while the model calls tools — finishReason STOP throughout", async () => {
    plan(
      turn({ parts: [{ functionCall: call("read_file") }], calls: [call("read_file")], finishReason: "STOP" }),
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")], finishReason: "STOP" }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
    );
    await run(harness().ctx);
    expect(streamTurn).toHaveBeenCalledTimes(3);
  });

  it("stops on an empty turn without pushing an illegal empty model part", async () => {
    plan(turn({ parts: [] }), turn({ fragments: ["never"] }));
    await run(harness().ctx);
    expect(streamTurn).toHaveBeenCalledTimes(1);
  });
});

describe("conversation shape", () => {
  it("echoes the model turn back verbatim, thoughtSignature intact", async () => {
    const parts = [{ functionCall: call("read_file"), thoughtSignature: "SIG" }];
    plan(turn({ parts, calls: [call("read_file")] }), turn({ fragments: ["ok"], parts: [{ text: "ok" }] }));
    await run(harness().ctx);

    const second = vi.mocked(streamTurn).mock.calls[1][0].contents;
    expect(second[1]).toEqual({ role: "model", parts });
    expect(second[1].parts[0].thoughtSignature).toBe("SIG");
  });

  it("returns ALL tool results in ONE user turn", async () => {
    const calls = [call("read_file", { path: "a" }, "c1"), call("read_file", { path: "b" }, "c2")];
    plan(turn({ parts: calls.map((c) => ({ functionCall: c })), calls }), turn({ fragments: ["ok"], parts: [{ text: "ok" }] }));
    await run(harness().ctx);

    const second = vi.mocked(streamTurn).mock.calls[1][0].contents;
    const responses = second.filter((c) => c.parts.some((p) => p.functionResponse));
    expect(responses).toHaveLength(1);
    expect(responses[0].role).toBe("user");
    expect(responses[0].parts).toHaveLength(2);
  });

  it("wraps every tool response in an object, never a bare string", async () => {
    plan(turn({ parts: [{ functionCall: call("read_file") }], calls: [call("read_file")] }), turn({ fragments: ["ok"], parts: [{ text: "ok" }] }));
    vi.mocked(tools.execute).mockResolvedValue(okOutcome({ payload: { content: "file bytes" } }));
    await run(harness().ctx);

    // `contents` is mutated in place across turns, so find the response turn by
    // shape rather than by position.
    const parts = vi
      .mocked(streamTurn)
      .mock.calls[1][0].contents.flatMap((c) => c.parts)
      .filter((p) => p.functionResponse);
    expect(parts).toHaveLength(1);
    expect(typeof parts[0].functionResponse!.response).toBe("object");
    expect(parts[0].functionResponse!.response).toEqual({ content: "file bytes" });
  });
});

describe("what the user sees", () => {
  it("streams each text fragment as a delta, in order", async () => {
    plan(turn({ fragments: ["Look", "ing at ", "Hero."], parts: [{ text: "Looking at Hero." }] }));
    const h = harness();
    const result = await run(h.ctx);
    expect(h.typed("text_delta").map((e) => e.text)).toEqual(["Look", "ing at ", "Hero."]);
    expect(result.text).toBe("Looking at Hero.");
  });

  it("the persisted text is EXACTLY the concatenated deltas, across turns", async () => {
    plan(
      turn({ fragments: ["Reading it. "], parts: [{ text: "Reading it. ", functionCall: undefined }, { functionCall: call("read_file") }], calls: [call("read_file")] }),
      turn({ fragments: ["Done."], parts: [{ text: "Done." }] }),
    );
    const h = harness();
    const result = await run(h.ctx);
    expect(result.text).toBe(h.deltas());
    expect(result.text).toBe("Reading it. \n\nDone.");
  });

  it("emits tool_call before tool_result, with a matching id", async () => {
    plan(turn({ parts: [{ functionCall: call("edit_file", {}, "c9") }], calls: [call("edit_file", {}, "c9")] }), turn({ fragments: ["ok"], parts: [{ text: "ok" }] }));
    const h = harness();
    await run(h.ctx);
    expect(h.typed("tool_call")[0]).toMatchObject({ id: "c9", name: "edit_file" });
    expect(h.typed("tool_result")[0]).toMatchObject({ id: "c9", ok: true, summary: "did the thing" });
    expect(h.events.findIndex((e) => e.type === "tool_call")).toBeLessThan(h.events.findIndex((e) => e.type === "tool_result"));
  });

  it("synthesises a unique id when the API omits one", async () => {
    const calls = [call("read_file", { path: "a" }), call("read_file", { path: "b" })];
    plan(turn({ parts: calls.map((c) => ({ functionCall: c })), calls }), turn({ fragments: ["ok"], parts: [{ text: "ok" }] }));
    const h = harness();
    await run(h.ctx);
    const ids = h.typed("tool_call").map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("publishes file_changed and counts distinct paths", async () => {
    const calls = [call("edit_file", { path: "a" }, "1"), call("edit_file", { path: "a" }, "2"), call("edit_file", { path: "b" }, "3")];
    plan(turn({ parts: calls.map((c) => ({ functionCall: c })), calls }), turn({ fragments: ["ok"], parts: [{ text: "ok" }] }));
    vi.mocked(tools.execute).mockImplementation(async (c) =>
      okOutcome({ changes: [{ type: "file_changed", path: String(c.args.path), op: "update", sectionSlug: null }] }),
    );
    const h = harness();
    const result = await run(h.ctx);
    expect(h.typed("file_changed")).toHaveLength(3);
    expect(result.filesChanged).toBe(2);
  });

  it("a failed tool is reported, not fatal", async () => {
    plan(turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }), turn({ fragments: ["retrying"], parts: [{ text: "retrying" }] }));
    vi.mocked(tools.execute).mockResolvedValueOnce({ ok: false, summary: "old_string not found", payload: { error: "old_string not found" } });
    const h = harness();
    await expect(run(h.ctx)).resolves.toMatchObject({ filesChanged: 0 });
    expect(h.typed("tool_result")[0]).toMatchObject({ ok: false });
  });

  it("emits usage once, summed over every turn", async () => {
    plan(
      turn({ parts: [{ functionCall: call("read_file") }], calls: [call("read_file")] }),
      turn({ fragments: ["ok"], parts: [{ text: "ok" }] }),
    );
    const h = harness();
    await run(h.ctx);
    expect(h.typed("usage")).toEqual([{ type: "usage", promptTokenCount: 20, candidatesTokenCount: 10 }]);
  });

  it("never emits status or done — those belong to the job lifecycle", async () => {
    plan(turn({ fragments: ["ok"], parts: [{ text: "ok" }] }));
    const h = harness();
    await run(h.ctx);
    expect(h.events.some((e) => e.type === "status" || e.type === "done")).toBe(false);
  });
});

describe("cancellation", () => {
  it("throws Cancelled before the first request when already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    plan(turn({ fragments: ["never"] }));
    await expect(run(harness(ac.signal).ctx)).rejects.toBeInstanceOf(Cancelled);
    expect(streamTurn).not.toHaveBeenCalled();
  });

  it("converts fetch's AbortError into Cancelled", async () => {
    const ac = new AbortController();
    vi.mocked(streamTurn).mockReset();
    vi.mocked(streamTurn).mockImplementation(async () => {
      ac.abort();
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    });
    await expect(run(harness(ac.signal).ctx)).rejects.toBeInstanceOf(Cancelled);
  });

  it("stops between tool calls once aborted", async () => {
    const ac = new AbortController();
    const calls = [call("edit_file", {}, "1"), call("edit_file", {}, "2")];
    plan(turn({ parts: calls.map((c) => ({ functionCall: c })), calls }));
    vi.mocked(tools.execute).mockImplementationOnce(async () => {
      ac.abort();
      return okOutcome();
    });
    await expect(run(harness(ac.signal).ctx)).rejects.toBeInstanceOf(Cancelled);
    expect(tools.execute).toHaveBeenCalledTimes(1);
  });
});

describe("never ends silently", () => {
  it("explains itself when the model changes a file but says nothing", async () => {
    plan(
      turn({ parts: [{ functionCall: call("edit_file", { path: "a" }) }], calls: [call("edit_file", { path: "a" })] }),
      turn({ parts: [{ text: "" }] }),
    );
    vi.mocked(tools.execute).mockResolvedValue(
      okOutcome({ changes: [{ type: "file_changed", path: "a", op: "update", sectionSlug: null }] }),
    );
    const h = harness();
    const result = await run(h.ctx);
    expect(result.text).toContain("without commentary");
    expect(h.deltas()).toBe(result.text);
  });

  it("surfaces an abnormal finishReason instead of an empty bubble", async () => {
    plan(turn({ parts: [{ text: "" }], finishReason: "SAFETY" }));
    const result = await run(harness().ctx);
    expect(result.text).toContain("SAFETY");
  });

  it("stays quiet when the model DID speak", async () => {
    plan(turn({ fragments: ["all set"], parts: [{ text: "all set" }] }));
    const result = await run(harness().ctx);
    expect(result.text).toBe("all set");
  });
});

describe("step ceiling", () => {
  it("stops after MAX_STEPS and tells the user instead of running forever", async () => {
    const mock = vi.mocked(streamTurn);
    mock.mockReset();
    mock.mockImplementation(async () => turn({ parts: [{ functionCall: call("read_file") }], calls: [call("read_file")] }).result);
    const h = harness();
    const result = await run(h.ctx);
    expect(mock).toHaveBeenCalledTimes(12);
    expect(result.text).toContain("stopped after 12 steps");
    expect(h.deltas()).toBe(result.text);
  });
});

describe("token ceiling", () => {
  it("stops before making a request it cannot afford", async () => {
    // Checked BEFORE the request, not after: the point is to not spend money on
    // a turn the loop has already decided it cannot pay for.
    plan(
      turn({
        parts: [{ functionCall: call("read_file") }],
        calls: [call("read_file")],
        usage: { promptTokenCount: 300_000, candidatesTokenCount: 0 },
      }),
      turn({ fragments: ["never reached"], parts: [{ text: "never reached" }] }),
    );
    const h = harness();
    const result = await run(h.ctx);

    expect(vi.mocked(streamTurn)).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("300k tokens");
    expect(result.text).not.toContain("never reached");
  });

  it("still runs the tools the last affordable turn asked for", async () => {
    // The edit is the useful part. Abandoning a call the model already paid to
    // make would spend the tokens and throw away what they bought.
    plan(
      turn({
        parts: [{ functionCall: call("edit_file") }],
        calls: [call("edit_file")],
        usage: { promptTokenCount: 300_000, candidatesTokenCount: 0 },
      }),
      turn({ parts: [], calls: [] }),
    );
    const h = harness();
    await run(h.ctx);
    expect(vi.mocked(tools.execute)).toHaveBeenCalledTimes(1);
  });

  it("makes at least one request even though the counter starts at zero", async () => {
    plan(turn({ fragments: ["hi"], parts: [{ text: "hi" }] }));
    await run(harness().ctx);
    expect(vi.mocked(streamTurn)).toHaveBeenCalledTimes(1);
  });
});

/**
 * The gate (§7). The model saying "done" is not evidence that the page still
 * compiles — it is evidence that the model thinks so.
 */
describe("typecheck gate", () => {
  it("checks the workspace when the model finishes having written something", async () => {
    plan(
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
    );
    vi.mocked(tools.execute).mockResolvedValue(wroteHero);
    await run(harness().ctx);
    expect(vi.mocked(typecheck.run)).toHaveBeenCalledTimes(1);
  });

  it("does not re-run the check the model itself just ran", async () => {
    // The model calls `typecheck` on its own more often than not. Running it
    // again two seconds later, over a workspace nothing has touched in between,
    // buys nothing and the user waits for it.
    plan(
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ parts: [{ functionCall: call("typecheck") }], calls: [call("typecheck")] }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
    );
    vi.mocked(tools.execute)
      .mockResolvedValueOnce(wroteHero)
      .mockResolvedValueOnce(okOutcome({ summary: "type check passed" }));

    await run(harness().ctx);
    expect(vi.mocked(typecheck.run)).not.toHaveBeenCalled();
  });

  it("DOES check again when the model edited after its own check", async () => {
    plan(
      turn({ parts: [{ functionCall: call("typecheck") }], calls: [call("typecheck")] }),
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
    );
    vi.mocked(tools.execute)
      .mockResolvedValueOnce(okOutcome({ summary: "type check passed" }))
      .mockResolvedValueOnce(wroteHero);

    await run(harness().ctx);
    expect(vi.mocked(typecheck.run)).toHaveBeenCalledTimes(1);
  });

  it("does not trust a FAILING check the model ran and then ignored", async () => {
    plan(
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ parts: [{ functionCall: call("typecheck") }], calls: [call("typecheck")] }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
      turn({ fragments: ["still done"], parts: [{ text: "still done" }] }),
      turn({ fragments: ["really done"], parts: [{ text: "really done" }] }),
    );
    vi.mocked(tools.execute)
      .mockResolvedValueOnce(wroteHero)
      .mockResolvedValueOnce({ ok: false, summary: "1 type error", payload: { ok: false } });
    vi.mocked(typecheck.run).mockResolvedValue({ diagnostics: [diagnostic()] });

    const result = await run(harness().ctx);
    expect(vi.mocked(typecheck.run)).toHaveBeenCalled();
    expect(result.text).toContain("still has 1 type error");
  });

  it("does NOT check when the model changed nothing", async () => {
    // A read-only turn cannot have broken anything, and running the check would
    // hand the model errors that were already there — somebody else's bug, on
    // this user's bill.
    plan(
      turn({ parts: [{ functionCall: call("read_file") }], calls: [call("read_file")] }),
      turn({ fragments: ["it says 42"], parts: [{ text: "it says 42" }] }),
    );
    await run(harness().ctx);
    expect(vi.mocked(typecheck.run)).not.toHaveBeenCalled();
  });

  it("says nothing about types when the check passes", async () => {
    plan(
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ fragments: ["made it bigger"], parts: [{ text: "made it bigger" }] }),
    );
    vi.mocked(tools.execute).mockResolvedValue(wroteHero);
    const result = await run(harness().ctx);
    expect(result.text).toBe("made it bigger");
  });

  it("hands the errors back and lets the model try again", async () => {
    plan(
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ fragments: ["fixed it"], parts: [{ text: "fixed it" }] }),
    );
    vi.mocked(tools.execute).mockResolvedValue(wroteHero);
    vi.mocked(typecheck.run)
      .mockResolvedValueOnce({ diagnostics: [diagnostic()] })
      .mockResolvedValueOnce({ diagnostics: [] });

    const h = harness();
    const result = await run(h.ctx);

    expect(vi.mocked(streamTurn)).toHaveBeenCalledTimes(4);
    const sent = vi.mocked(streamTurn).mock.calls[0][0].contents;
    const repair = sent.find((c) => c.parts.some((p) => p.text?.includes("does not type-check")));
    expect(repair?.role).toBe("user");
    expect(repair?.parts[0].text).toContain("sections/hero.tsx(12,5)");
    expect(result.text).toContain("fixed it");
    expect(result.text).not.toContain("still has");
  });

  it("does not leak the repair instruction into the transcript", async () => {
    // It is an instruction to the model, not something the user said or heard.
    plan(
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
      turn({ fragments: ["fixed"], parts: [{ text: "fixed" }] }),
    );
    vi.mocked(tools.execute).mockResolvedValue(wroteHero);
    vi.mocked(typecheck.run)
      .mockResolvedValueOnce({ diagnostics: [diagnostic()] })
      .mockResolvedValueOnce({ diagnostics: [] });
    const h = harness();
    await run(h.ctx);
    expect(h.deltas()).not.toContain("does not type-check");
  });

  it("gives up after MAX_REPAIRS and says the page is still broken", async () => {
    // Ending "done" over a page that no longer compiles is the exact failure
    // the gate exists to catch. Silence here would be worse than no gate.
    const mock = vi.mocked(streamTurn);
    mock.mockReset();
    let n = 0;
    mock.mockImplementation(async (input) => {
      // Edit, then claim to be finished — forever.
      if (n++ % 2 === 0) {
        return turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }).result;
      }
      await input.onText("done");
      return turn({ parts: [{ text: "done" }] }).result;
    });
    vi.mocked(tools.execute).mockResolvedValue(wroteHero);
    vi.mocked(typecheck.run).mockResolvedValue({
      diagnostics: [diagnostic(), diagnostic({ line: 40 })],
    });

    const h = harness();
    const result = await run(h.ctx);

    // Two repairs offered, then one final check that decides to stop trying.
    expect(vi.mocked(typecheck.run)).toHaveBeenCalledTimes(3);
    expect(result.text).toContain("still has 2 type errors");
    expect(result.text).toContain("2 attempts");
    expect(result.text).toContain("sections/hero.tsx");
    expect(h.deltas()).toBe(result.text);
  });

  it("warns after a single failing check when there were no repairs left to spend", async () => {
    plan(
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
      turn({ fragments: ["nope"], parts: [{ text: "nope" }] }),
      turn({ fragments: ["still nope"], parts: [{ text: "still nope" }] }),
    );
    vi.mocked(tools.execute).mockResolvedValue(wroteHero);
    vi.mocked(typecheck.run).mockResolvedValue({ diagnostics: [diagnostic()] });
    const result = await run(harness().ctx);
    expect(result.text).toContain("still has 1 type error");
  });

  it("keeps the job alive when the checker itself could not run", async () => {
    // A missing binary is our problem. Reporting it as a broken edit would send
    // the model chasing an error that is not in the code.
    plan(
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
    );
    vi.mocked(tools.execute).mockResolvedValue(wroteHero);
    vi.mocked(typecheck.run).mockResolvedValue({ diagnostics: null, error: "tsc: not found" });

    const h = harness();
    const result = await run(h.ctx);
    expect(vi.mocked(streamTurn)).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("done");
    expect(h.typed("tool_result").at(-1)).toMatchObject({ name: "typecheck", ok: false });
  });

  it("shows the check in the stream, so it is not a silent pause", async () => {
    plan(
      turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }),
      turn({ fragments: ["done"], parts: [{ text: "done" }] }),
    );
    vi.mocked(tools.execute).mockResolvedValue(wroteHero);
    const h = harness();
    await run(h.ctx);

    const started = h.typed("tool_call").filter((e) => e.name === "typecheck");
    const finished = h.typed("tool_result").filter((e) => e.name === "typecheck");
    expect(started).toHaveLength(1);
    expect(finished).toHaveLength(1);
    expect(started[0].id).toBe(finished[0].id);
    expect(finished[0]).toMatchObject({ ok: true, summary: "type check passed" });
  });

  it("counts a repair round against the step ceiling", async () => {
    // A repair is real model work and has to be paid for out of the same
    // budget, or a stubborn error becomes an unbounded loop.
    const mock = vi.mocked(streamTurn);
    mock.mockReset();
    mock.mockImplementation(async (input) => {
      await input.onText("done");
      return turn({ parts: [{ functionCall: call("edit_file") }], calls: [call("edit_file")] }).result;
    });
    vi.mocked(tools.execute).mockResolvedValue(wroteHero);
    const result = await run(harness().ctx);
    expect(mock).toHaveBeenCalledTimes(12);
    expect(result.text).toContain("stopped after 12 steps");
  });
});

describe("a tool that writes more than one file", () => {
  it("publishes every change and arms the gate once", async () => {
    // add_section writes three files in a single call. Each one needs its own
    // file_changed — the ChangeCard has no other source — and between them they
    // are one reason to type-check, not three.
    const add = call("add_section", { slug: "pricing" }, "a1");
    plan(
      turn({ parts: [{ functionCall: add }], calls: [add] }),
      turn({ fragments: ["added it"], parts: [{ text: "added it" }] }),
    );
    vi.mocked(tools.execute).mockResolvedValue(
      okOutcome({
        changes: [
          { type: "file_changed", path: "sections/pricing.tsx", op: "create", sectionSlug: "pricing" },
          { type: "file_changed", path: "manifest.ts", op: "update", sectionSlug: null },
          { type: "file_changed", path: "page.tsx", op: "update", sectionSlug: null },
        ],
      }),
    );

    const h = harness();
    const result = await run(h.ctx);

    expect(h.typed("file_changed").map((e) => e.path)).toEqual([
      "sections/pricing.tsx",
      "manifest.ts",
      "page.tsx",
    ]);
    expect(result.filesChanged).toBe(3);
    expect(typecheck.run).toHaveBeenCalledTimes(1);
  });
});
