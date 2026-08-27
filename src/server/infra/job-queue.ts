/**
 * Layer 3 · infra — a serial, in-process job queue. One job runs at a time.
 *
 * Serial on purpose: from Phase 3 the worker writes into `src/workspace/`, and
 * two agents editing the same tree concurrently would interleave their reads and
 * writes into nonsense. This is a single-user local studio; a queue depth of one
 * is the correct amount of concurrency.
 *
 * Stored on `globalThis` for the same reason as the event bus — Turbopack
 * re-evaluates server modules mid-job, and a plain module-level array would come
 * back empty with the active job orphaned (§14, risk 1).
 */

export type JobTask = (signal: AbortSignal) => Promise<void>;

interface QueueState {
  waiting: { jobId: string; task: JobTask }[];
  active: { jobId: string; controller: AbortController } | null;
  draining: boolean;
}

const KEY = Symbol.for("originEd.jobQueue");

function state(): QueueState {
  const g = globalThis as unknown as Record<symbol, QueueState | undefined>;
  if (!g[KEY]) g[KEY] = { waiting: [], active: null, draining: false };
  return g[KEY];
}

/** Fire-and-forget: returns as soon as the job is queued, never awaits the run. */
export function enqueue(jobId: string, task: JobTask): void {
  state().waiting.push({ jobId, task });
  void drain();
}

async function drain(): Promise<void> {
  const s = state();
  if (s.draining) return;
  s.draining = true;
  try {
    for (;;) {
      // Re-read state() each pass: an HMR swap mid-job would otherwise leave us
      // draining a queue object nobody else can see.
      const current = state();
      const next = current.waiting.shift();
      if (!next) return;

      const controller = new AbortController();
      current.active = { jobId: next.jobId, controller };
      try {
        await next.task(controller.signal);
      } catch (err) {
        // The task owns its own error reporting (it has the emitter). Reaching
        // here means it threw *outside* that handling — log and keep draining,
        // because a dead queue is a studio that silently stops responding.
        console.error(`[job-queue] job ${next.jobId} threw out of its handler`, err);
      } finally {
        state().active = null;
      }
    }
  } finally {
    state().draining = false;
  }
}

export type CancelOutcome = "cancelled-running" | "cancelled-queued" | "not-found";

/**
 * Aborts the signal handed to a running task, or drops a job that has not
 * started yet. Marking the row `cancelled` is the caller's job — the queue does
 * not know about Postgres.
 */
export function cancel(jobId: string): CancelOutcome {
  const s = state();
  if (s.active?.jobId === jobId) {
    s.active.controller.abort();
    return "cancelled-running";
  }
  const index = s.waiting.findIndex((entry) => entry.jobId === jobId);
  if (index >= 0) {
    s.waiting.splice(index, 1);
    return "cancelled-queued";
  }
  return "not-found";
}

export function activeJobId(): string | null {
  return state().active?.jobId ?? null;
}

export function depth(): number {
  const s = state();
  return s.waiting.length + (s.active ? 1 : 0);
}
