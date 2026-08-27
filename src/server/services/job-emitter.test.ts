/**
 * The persist-before-fanout contract (§8). Everything downstream — SSE replay,
 * reconnect, refresh, multi-tab — is only correct if this file is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@/lib/types";
import type { PendingEvent } from "@/server/repositories/event.repo";
import { createEmitter, flushJob, FLUSH_MS, type EmitterDeps } from "./job-emitter";

interface Recorder {
  deps: EmitterDeps;
  /** Every side effect in the order it actually happened. */
  log: string[];
  persisted: PendingEvent[];
  published: JobEvent[];
}

function recorder(options: { maxSeq?: number; appendDelayMs?: number } = {}): Recorder {
  const log: string[] = [];
  const persisted: PendingEvent[] = [];
  const published: JobEvent[] = [];

  const settle = async () => {
    if (options.appendDelayMs) await new Promise((r) => setTimeout(r, options.appendDelayMs));
  };

  return {
    log,
    persisted,
    published,
    deps: {
      maxSeq: async () => options.maxSeq ?? 0,
      append: async (event) => {
        await settle();
        persisted.push(event);
        log.push(`append:${event.seq}:${event.data.type}`);
      },
      appendMany: async (events) => {
        await settle();
        persisted.push(...events);
        log.push(`appendMany:${events.map((e) => e.seq).join(",")}`);
      },
      publish: (event) => {
        published.push(event);
        log.push(`publish:${event.seq}:${event.type}`);
      },
    },
  };
}

describe("job-emitter", () => {
  beforeEach(() => {
    vi.useRealTimers();
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("originEd.jobEmitters")] = undefined;
  });

  it("seeds seq from max(seq) so a job resumed after HMR does not collide", async () => {
    const rec = recorder({ maxSeq: 41 });
    const emitter = await createEmitter("job-1", rec.deps);

    await emitter.emit({ type: "status", status: "running" });

    expect(emitter.seq()).toBe(42);
    expect(rec.persisted[0].seq).toBe(42);
  });

  it("persists a non-text event BEFORE publishing it", async () => {
    const rec = recorder({ appendDelayMs: 5 });
    const emitter = await createEmitter("job-1", rec.deps);

    await emitter.emit({ type: "status", status: "running" });

    expect(rec.log).toEqual(["append:1:status", "publish:1:status"]);
  });

  it("a checkpoint costs ONE insert even with text pending", async () => {
    const rec = recorder();
    const emitter = await createEmitter("job-1", rec.deps);

    for (const word of ["some ", "words "]) {
      await emitter.emit({ type: "text_delta", text: word });
    }
    await emitter.emit({ type: "tool_call", id: "c1", name: "edit_file", args: {} });

    const writes = rec.log.filter((l) => l.startsWith("append"));
    expect(writes).toEqual(["appendMany:1,2,3"]);
  });

  it("publishes a text_delta immediately and persists it later", async () => {
    const rec = recorder();
    const emitter = await createEmitter("job-1", rec.deps);

    await emitter.emit({ type: "text_delta", text: "Hello " });

    // The token is already on the bus...
    expect(rec.published.map((e) => e.seq)).toEqual([1]);
    // ...and not yet in Postgres.
    expect(rec.persisted).toHaveLength(0);

    await emitter.flush();
    expect(rec.persisted.map((e) => e.seq)).toEqual([1]);
  });

  it("coalesces a burst of tokens into ONE insert", async () => {
    const rec = recorder();
    const emitter = await createEmitter("job-1", rec.deps);

    for (const word of ["a ", "burst ", "of ", "tokens"]) {
      await emitter.emit({ type: "text_delta", text: word });
    }
    await emitter.flush();

    expect(rec.log.filter((entry) => entry.startsWith("appendMany"))).toEqual(["appendMany:1,2,3,4"]);
    expect(rec.published).toHaveLength(4);
  });

  it("flushes pending text before a checkpoint event, keeping job_events ordered", async () => {
    const rec = recorder();
    const emitter = await createEmitter("job-1", rec.deps);

    await emitter.emit({ type: "text_delta", text: "before " });
    await emitter.emit({ type: "tool_call", id: "c1", name: "edit_file", args: {} });
    await emitter.emit({ type: "text_delta", text: "after" });
    await emitter.flush();

    // What matters: nothing lands in Postgres out of seq order, because a replay
    // would otherwise show the tool card before the words leading up to it.
    expect(rec.persisted.map((e) => e.seq)).toEqual([1, 2, 3]);
    // And the pending token rides along in the checkpoint's own insert — one
    // round trip, not a flush followed by an append.
    expect(rec.log).toEqual([
      "publish:1:text_delta",
      "appendMany:1,2",
      "publish:2:tool_call",
      "publish:3:text_delta",
      "appendMany:3",
    ]);
  });

  it("flushes on its own after FLUSH_MS without any other event", async () => {
    const rec = recorder();
    const emitter = await createEmitter("job-1", rec.deps);

    await emitter.emit({ type: "text_delta", text: "tick" });
    expect(rec.persisted).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS + 60));

    expect(rec.persisted.map((e) => e.seq)).toEqual([1]);
    await emitter.dispose();
  });

  it("hands out a strictly increasing seq across mixed event types", async () => {
    const rec = recorder();
    const emitter = await createEmitter("job-1", rec.deps);

    await emitter.emit({ type: "status", status: "running" });
    await emitter.emit({ type: "text_delta", text: "one " });
    await emitter.emit({ type: "text_delta", text: "two " });
    await emitter.emit({ type: "tool_call", id: "c1", name: "read_file", args: {} });
    await emitter.emit({ type: "text_delta", text: "three" });
    await emitter.emit({ type: "done", status: "succeeded", filesChanged: 0 });
    await emitter.dispose();

    const seqs = rec.persisted.map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rec.published.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    // Every event reaches BOTH sides — no variant is bus-only or db-only.
    expect(rec.persisted).toHaveLength(rec.published.length);
  });

  it("dispose flushes what is still pending and stops the timer", async () => {
    const rec = recorder();
    const emitter = await createEmitter("job-1", rec.deps);

    await emitter.emit({ type: "text_delta", text: "trailing" });
    await emitter.dispose();

    expect(rec.persisted.map((e) => e.seq)).toEqual([1]);

    const before = rec.persisted.length;
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS + 60));
    expect(rec.persisted).toHaveLength(before);
  });

  /**
   * The regression this exists for: an end-to-end run showed a client that
   * dropped at seq 6 and reconnected mid-job resuming at seq 12. Deltas 7–11
   * had gone out on the bus but were still in the coalescing buffer, so the
   * replay query could not see them and they were lost for that client.
   */
  describe("flushJob — closes the mid-job replay hole", () => {
    it("forces a running job's pending text into Postgres on demand", async () => {
      const rec = recorder();
      const emitter = await createEmitter("job-live", rec.deps);

      await emitter.emit({ type: "text_delta", text: "in flight" });
      expect(rec.persisted).toHaveLength(0); // a replay right now would miss it

      await flushJob("job-live");

      expect(rec.persisted.map((e) => e.seq)).toEqual([1]);
      await emitter.dispose();
    });

    it("leaves nothing unpersisted that has already been published", async () => {
      const rec = recorder();
      const emitter = await createEmitter("job-live", rec.deps);

      for (const word of ["a ", "b ", "c "]) {
        await emitter.emit({ type: "text_delta", text: word });
      }
      await flushJob("job-live");

      // The invariant an SSE replay depends on.
      expect(rec.persisted.map((e) => e.seq)).toEqual(rec.published.map((e) => e.seq));
      await emitter.dispose();
    });

    it("is a no-op for a job that already finished and deregistered", async () => {
      const rec = recorder();
      const emitter = await createEmitter("job-over", rec.deps);
      await emitter.emit({ type: "text_delta", text: "done" });
      await emitter.dispose();

      const before = rec.persisted.length;
      await expect(flushJob("job-over")).resolves.toBeUndefined();
      expect(rec.persisted).toHaveLength(before);
    });

    it("is a no-op for a job that never existed", async () => {
      await expect(flushJob("nobody")).resolves.toBeUndefined();
    });
  });

  it("serialises writes so a slow insert cannot land out of order", async () => {
    const rec = recorder({ appendDelayMs: 10 });
    const emitter = await createEmitter("job-1", rec.deps);

    await Promise.all([
      emitter.emit({ type: "status", status: "running" }),
      emitter.emit({ type: "tool_call", id: "c1", name: "read_file", args: {} }),
      emitter.emit({ type: "tool_result", id: "c1", name: "read_file", ok: true, summary: "ok" }),
    ]);

    expect(rec.persisted.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});
