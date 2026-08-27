/**
 * The one place the "persist first, then fan out" rule from §8 is implemented.
 *
 * Every event gets a monotonic `seq`, is written to `job_events`, and only then
 * published to the in-memory bus. That ordering is what buys reconnect,
 * refresh-durability and multi-tab for free: an SSE client replays
 * `seq > Last-Event-ID` from Postgres and then subscribes, and nothing can slip
 * through the gap.
 *
 * `text_delta` is the deliberate exception. It goes to the bus IMMEDIATELY and
 * is batched into Postgres on a ~250ms flush — one row per token would be
 * hundreds of round-trips per job for data that is already recoverable from the
 * persisted model message. Before any *other* event is written, the pending
 * batch is flushed, so what lands in `job_events` is always a contiguous prefix
 * of the stream plus at most one in-flight text batch.
 *
 * That in-flight batch is the one hole the coalescing opens: a client
 * reconnecting mid-job would replay from Postgres and silently skip up to
 * FLUSH_MS of tokens that had already gone out on the bus. Hence the registry
 * below — a stream can force the running job's pending batch down before it
 * reads, which makes "everything published so far is persisted" true at exactly
 * the moment a replay needs it to be.
 */
import type { JobEvent, JobEventData } from "@/lib/types";
import * as bus from "@/server/infra/event-bus";
import * as eventRepo from "@/server/repositories/event.repo";

export const FLUSH_MS = 250;

export interface JobEmitter {
  /** Persist (or batch, for text) and publish. Awaits the write for non-text. */
  emit(data: JobEventData): Promise<void>;
  /** Force the pending text batch to Postgres. */
  flush(): Promise<void>;
  /** Highest seq handed out so far. */
  seq(): number;
  /** Stop the flush timer. Call once when the job is over. */
  dispose(): Promise<void>;
}

export interface EmitterDeps {
  append: (event: eventRepo.PendingEvent) => Promise<void>;
  appendMany: (events: eventRepo.PendingEvent[]) => Promise<void>;
  maxSeq: (jobId: string) => Promise<number>;
  publish: (event: JobEvent) => void;
}

const defaultDeps: EmitterDeps = {
  append: eventRepo.append,
  appendMany: eventRepo.appendMany,
  maxSeq: eventRepo.maxSeq,
  publish: bus.publish,
};

/**
 * Live emitters by job id, so an SSE connection can flush a job that is still
 * running before it replays. `globalThis` for the usual HMR reason (§14).
 */
const REGISTRY = Symbol.for("originEd.jobEmitters");

function registry(): Map<string, JobEmitter> {
  const g = globalThis as unknown as Record<symbol, Map<string, JobEmitter> | undefined>;
  if (!g[REGISTRY]) g[REGISTRY] = new Map();
  return g[REGISTRY];
}

/**
 * Forces a running job's coalesced text into Postgres. No-op once the job has
 * finished and deregistered — by then `dispose` has already flushed.
 */
export async function flushJob(jobId: string): Promise<void> {
  await registry().get(jobId)?.flush();
}

/**
 * Seeds the counter from `max(seq)` so a job resumed after an HMR reload
 * continues the sequence instead of colliding on `unique (job_id, seq)`.
 */
export async function createEmitter(jobId: string, deps: EmitterDeps = defaultDeps): Promise<JobEmitter> {
  let counter = await deps.maxSeq(jobId);
  let pending: eventRepo.PendingEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // Every Postgres write goes through this chain, so the timer-driven flush and
  // an inline append can never race into the wrong order.
  let chain: Promise<unknown> = Promise.resolve();
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = chain.then(work, work);
    chain = next.catch(() => {});
    return next;
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /**
   * Write, and if the number was taken, renumber and write again.
   *
   * `counter` is a guess about a column two processes can reach. It is seeded
   * from `max(seq)` once and then only ever incremented, which is right for the
   * one worker that owns the job — and wrong the moment anything else appends,
   * which `job.service.cancel` does when it cannot find the job in its own
   * queue. Observed on job 8bf0ae6e: the cancel path took seq 2, the still-live
   * worker asked for seq 2, and the insert error propagated out of the agent
   * loop and turned a cancelled job into a failed one.
   *
   * Re-reading `max(seq)` is the repair rather than a client-side bump, because
   * losing the race means we do not know how far ahead the other writer got. One
   * retry: a second collision would mean a writer that is still going, and this
   * is an event stream, not a lock.
   */
  async function write(events: eventRepo.PendingEvent[], batched: boolean): Promise<number> {
    // Which repo call is not a size decision — anything carrying coalesced text
    // goes through `appendMany`, a lone checkpoint through `append`, so the two
    // paths stay legible in a trace even when the batch happens to hold one row.
    const put = (rows: eventRepo.PendingEvent[]) =>
      batched ? deps.appendMany(rows) : deps.append(rows[0]);
    try {
      await put(events);
      return events[events.length - 1].seq;
    } catch (err) {
      if (!(err instanceof eventRepo.SeqTakenError)) throw err;
      const base = await deps.maxSeq(jobId);
      // Whatever the other writer reached is now the floor for everything after
      // this batch too, or the very next event would collide all over again.
      const renumbered = events.map((event, i) => ({ ...event, seq: base + i + 1 }));
      counter = Math.max(counter, base + events.length);
      await put(renumbered);
      return renumbered[renumbered.length - 1].seq;
    }
  }

  function writePending(): Promise<void> {
    clearTimer();
    if (pending.length === 0) return Promise.resolve();
    const batch = pending;
    pending = [];
    return serialize(() => write(batch, true)).then(() => {});
  }

  async function emit(data: JobEventData): Promise<void> {
    if (data.type === "text_delta") {
      const seq = ++counter;
      pending.push({ jobId, seq, data });
      // Straight to the bus — this is the token latency the whole design is for.
      deps.publish({ seq, jobId, ...data });
      if (timer === null && !disposed) {
        timer = setTimeout(() => void writePending(), FLUSH_MS);
      }
      return;
    }

    // Anything else is a checkpoint: text written before it must already be in
    // Postgres, or a replay would show tool cards before the words leading to them.
    // Pending text rides along in the SAME insert rather than a flush followed by
    // an append — one round trip instead of two, which measurably halves the
    // latency of every tool card against a remote Supabase.
    clearTimer();
    const batch = pending;
    pending = [];
    const seq = ++counter;
    const event: eventRepo.PendingEvent = { jobId, seq, data };

    const batched = batch.length > 0;
    if (batched) batch.push(event);
    // Publish the seq the row actually got, not the one we asked for: the bus
    // seq becomes the client's Last-Event-ID, and a number Postgres never used
    // would make the next replay skip everything up to it.
    const written = await serialize(() => write(batched ? batch : [event], batched));

    deps.publish({ seq: written, jobId, ...data });
  }

  const emitter: JobEmitter = {
    emit,
    flush: writePending,
    seq: () => counter,
    async dispose() {
      disposed = true;
      registry().delete(jobId);
      await writePending();
      await chain.catch(() => {});
    },
  };

  registry().set(jobId, emitter);
  return emitter;
}
