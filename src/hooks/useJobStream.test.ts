/**
 * The client-side half of the contract. The reducer is pure on purpose so the
 * hard cases — replay redelivering events the UI already has, a reconnect
 * arriving mid-tool-call — are testable without a browser.
 */
import { describe, expect, it } from "vitest";
import type { JobEventData } from "@/lib/types";
import { emptyStream, jobStreamReducer, type JobStreamState } from "./useJobStream";

const reduce = (state: JobStreamState, ...events: JobEventData[]) =>
  events.reduce((acc, data) => jobStreamReducer(acc, { kind: "event", data }), state);

const opened = (jobId = "job-1") => jobStreamReducer(emptyStream, { kind: "reset", jobId });

describe("jobStreamReducer", () => {
  it("accumulates text deltas in arrival order", () => {
    const state = reduce(
      opened(),
      { type: "text_delta", text: "Looking " },
      { type: "text_delta", text: "at " },
      { type: "text_delta", text: "Hero." },
    );
    expect(state.text).toBe("Looking at Hero.");
  });

  it("opens a ToolCard on tool_call and resolves it on tool_result", () => {
    let state = reduce(opened(), {
      type: "tool_call",
      id: "c1",
      name: "edit_file",
      args: { path: "sections/hero.tsx" },
    });
    expect(state.tools).toHaveLength(1);
    expect(state.tools[0].status).toBe("running");

    state = reduce(state, {
      type: "tool_result",
      id: "c1",
      name: "edit_file",
      ok: true,
      summary: "1 hunk",
    });
    expect(state.tools[0]).toMatchObject({ status: "ok", summary: "1 hunk" });
  });

  it("marks a failed tool result as an error, not a success", () => {
    const state = reduce(
      opened(),
      { type: "tool_call", id: "c1", name: "edit_file", args: {} },
      { type: "tool_result", id: "c1", name: "edit_file", ok: false, summary: "no match" },
    );
    expect(state.tools[0].status).toBe("error");
  });

  it("is idempotent when a replay redelivers a tool_call it already has", () => {
    const call: JobEventData = { type: "tool_call", id: "c1", name: "read_file", args: {} };
    const state = reduce(opened(), call, call, call);
    expect(state.tools).toHaveLength(1);
  });

  it("is idempotent for file_changed on the same path", () => {
    const changed: JobEventData = {
      type: "file_changed",
      path: "sections/hero.tsx",
      op: "update",
      sectionSlug: "hero",
    };
    expect(reduce(opened(), changed, changed).files).toHaveLength(1);
  });

  it("ignores a tool_result for a call it never saw rather than inventing a card", () => {
    const state = reduce(opened(), {
      type: "tool_result",
      id: "ghost",
      name: "edit_file",
      ok: true,
      summary: "1 hunk",
    });
    expect(state.tools).toHaveLength(0);
  });

  it("records status, usage and error without disturbing anything else", () => {
    const state = reduce(
      opened(),
      { type: "status", status: "running" },
      { type: "text_delta", text: "hi" },
      { type: "usage", promptTokenCount: 1284, candidatesTokenCount: 96 },
      { type: "error", message: "boom" },
    );
    expect(state.status).toBe("running");
    expect(state.usage).toEqual({ promptTokenCount: 1284, candidatesTokenCount: 96 });
    expect(state.error).toBe("boom");
    expect(state.text).toBe("hi");
    expect(state.done).toBe(false);
  });

  it("done closes the turn and carries the final status", () => {
    const state = reduce(opened(), { type: "done", status: "cancelled", filesChanged: 0 });
    expect(state).toMatchObject({ done: true, status: "cancelled", connected: false });
  });

  it("a full scripted job produces exactly what the transcript needs", () => {
    const state = reduce(
      opened("job-9"),
      { type: "status", status: "running" },
      { type: "text_delta", text: "Reading. " },
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "sections/hero.tsx" } },
      { type: "tool_result", id: "c1", name: "read_file", ok: true, summary: "444 lines" },
      { type: "tool_call", id: "c2", name: "edit_file", args: { path: "sections/hero.tsx" } },
      { type: "tool_result", id: "c2", name: "edit_file", ok: true, summary: "1 hunk" },
      { type: "file_changed", path: "sections/hero.tsx", op: "update", sectionSlug: "hero" },
      { type: "text_delta", text: "Done." },
      { type: "usage", promptTokenCount: 10, candidatesTokenCount: 2 },
      { type: "done", status: "succeeded", filesChanged: 1 },
    );

    expect(state.text).toBe("Reading. Done.");
    expect(state.tools.map((t) => t.status)).toEqual(["ok", "ok"]);
    expect(state.files).toEqual([
      { path: "sections/hero.tsx", op: "update", sectionSlug: "hero" },
    ]);
    expect(state).toMatchObject({ done: true, status: "succeeded", jobId: "job-9" });
  });

  describe("connection lifecycle", () => {
    it("open marks connected, a drop marks reconnecting", () => {
      let state = jobStreamReducer(opened(), { kind: "open" });
      expect(state.connected).toBe(true);
      state = jobStreamReducer(state, { kind: "drop" });
      expect(state.connected).toBe(false);
    });

    it("a drop after done is ignored — closing the stream is not a failure", () => {
      const done = reduce(opened(), { type: "done", status: "succeeded", filesChanged: 0 });
      expect(jobStreamReducer(done, { kind: "drop" })).toBe(done);
    });
  });

  describe("a job that ends mid-tool-call", () => {
    it("settles a tool still running when done arrives", () => {
      const state = reduce(
        opened(),
        { type: "tool_call", id: "c1", name: "edit_file", args: {} },
        { type: "done", status: "cancelled", filesChanged: 0 },
      );
      // Left `running`, its spinner turns forever — the studio claiming it is
      // still editing over a job that stopped.
      expect(state.tools[0]).toMatchObject({ status: "error", summary: "no result" });
    });

    it("keeps a result that did arrive rather than overwriting it", () => {
      const state = reduce(
        opened(),
        { type: "tool_call", id: "c1", name: "edit_file", args: {} },
        { type: "tool_result", id: "c1", name: "edit_file", ok: true, summary: "1 hunk" },
        { type: "done", status: "failed", filesChanged: 1 },
      );
      expect(state.tools[0]).toMatchObject({ status: "ok", summary: "1 hunk" });
    });

    it("does not call a dangling tool a failure when the job succeeded", () => {
      const state = reduce(
        opened(),
        { type: "tool_call", id: "c1", name: "read_file", args: {} },
        { type: "done", status: "succeeded", filesChanged: 0 },
      );
      expect(state.tools[0]).toMatchObject({ status: "ok", summary: null });
    });
  });

  describe("history", () => {
    it("reset archives the finished job's tool cards under its id", () => {
      const first = reduce(
        opened("job-1"),
        { type: "tool_call", id: "c1", name: "edit_file", args: {} },
        { type: "done", status: "succeeded", filesChanged: 1 },
      );

      const second = jobStreamReducer(first, { kind: "reset", jobId: "job-2" });

      expect(second.jobId).toBe("job-2");
      expect(second.tools).toHaveLength(0);
      expect(second.text).toBe("");
      expect(second.history["job-1"]).toHaveLength(1);
    });

    it("archives on done, not only on the next job's reset", () => {
      // The transcript refetches the moment `done` lands and the persisted model
      // turn reads its tool rows out of `history`. Archiving on the NEXT reset
      // blanks them in between — for as long as the user does not send again.
      const state = reduce(
        opened("job-1"),
        { type: "tool_call", id: "c1", name: "edit_file", args: {} },
        { type: "tool_result", id: "c1", name: "edit_file", ok: true, summary: "1 hunk" },
        { type: "done", status: "succeeded", filesChanged: 1 },
      );
      expect(state.history["job-1"]).toHaveLength(1);
      // And the archived copy is the settled one, not a frozen spinner.
      expect(state.history["job-1"][0].status).toBe("ok");
    });

    it("archives across several jobs without losing earlier ones", () => {
      let state = reduce(opened("job-1"), { type: "tool_call", id: "a", name: "read_file", args: {} });
      state = jobStreamReducer(state, { kind: "reset", jobId: "job-2" });
      state = reduce(state, { type: "tool_call", id: "b", name: "edit_file", args: {} });
      state = jobStreamReducer(state, { kind: "reset", jobId: "job-3" });

      expect(Object.keys(state.history).sort()).toEqual(["job-1", "job-2"]);
    });

    it("does not archive a job that made no tool calls", () => {
      let state = reduce(opened("job-1"), { type: "text_delta", text: "just talking" });
      state = jobStreamReducer(state, { kind: "reset", jobId: "job-2" });
      expect(state.history).toEqual({});
    });

    it("clear wipes live state but keeps the archive", () => {
      let state = reduce(opened("job-1"), { type: "tool_call", id: "a", name: "read_file", args: {} });
      state = jobStreamReducer(state, { kind: "clear" });
      expect(state.jobId).toBeNull();
      expect(state.history["job-1"]).toHaveLength(1);
    });
  });
});
