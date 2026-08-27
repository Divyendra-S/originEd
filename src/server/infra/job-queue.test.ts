/**
 * Serial execution is a correctness property, not a performance choice: from
 * Phase 3 two concurrent jobs would interleave reads and writes into the same
 * workspace tree.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { activeJobId, cancel, depth, enqueue } from "./job-queue";

/** The queue lives on globalThis (HMR survival), so each test starts fresh. */
beforeEach(() => {
  (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("originEd.jobQueue")] = undefined;
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("job-queue", () => {
  it("runs one job at a time, in order", async () => {
    const log: string[] = [];
    const gates = [deferred(), deferred(), deferred()];

    for (const [i, gate] of gates.entries()) {
      enqueue(`job-${i}`, async () => {
        log.push(`start-${i}`);
        await gate.promise;
        log.push(`end-${i}`);
      });
    }

    await tick();
    expect(log).toEqual(["start-0"]); // the other two are waiting their turn
    expect(depth()).toBe(3);

    gates[0].resolve();
    await tick();
    expect(log).toEqual(["start-0", "end-0", "start-1"]);

    gates[1].resolve();
    gates[2].resolve();
    await tick();
    await tick();

    expect(log).toEqual([
      "start-0", "end-0",
      "start-1", "end-1",
      "start-2", "end-2",
    ]);
    expect(depth()).toBe(0);
  });

  it("reports which job is active", async () => {
    const gate = deferred();
    enqueue("job-a", async () => {
      await gate.promise;
    });

    await tick();
    expect(activeJobId()).toBe("job-a");

    gate.resolve();
    await tick();
    expect(activeJobId()).toBeNull();
  });

  it("aborts the running job's signal on cancel", async () => {
    let aborted = false;
    const started = deferred();

    enqueue("job-a", async (signal) => {
      started.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        });
      });
    });

    await started.promise;
    expect(cancel("job-a")).toBe("cancelled-running");
    await tick();
    expect(aborted).toBe(true);
  });

  it("drops a queued job without ever starting it", async () => {
    const gate = deferred();
    let secondRan = false;

    enqueue("job-a", async () => {
      await gate.promise;
    });
    enqueue("job-b", async () => {
      secondRan = true;
    });

    await tick();
    expect(cancel("job-b")).toBe("cancelled-queued");

    gate.resolve();
    await tick();
    await tick();

    expect(secondRan).toBe(false);
    expect(depth()).toBe(0);
  });

  it("reports not-found for a job it has never seen", () => {
    expect(cancel("nobody")).toBe("not-found");
  });

  it("keeps draining after a task throws — a dead queue is a dead studio", async () => {
    const log: string[] = [];

    enqueue("job-bad", async () => {
      log.push("bad");
      throw new Error("boom");
    });
    enqueue("job-good", async () => {
      log.push("good");
    });

    await tick();
    await tick();

    expect(log).toEqual(["bad", "good"]);
    expect(activeJobId()).toBeNull();
  });

  it("restarts draining when a job is enqueued after the queue went idle", async () => {
    const log: string[] = [];

    enqueue("job-1", async () => {
      log.push("one");
    });
    await tick();
    expect(depth()).toBe(0);

    enqueue("job-2", async () => {
      log.push("two");
    });
    await tick();

    expect(log).toEqual(["one", "two"]);
  });
});
