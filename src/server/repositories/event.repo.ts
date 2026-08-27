/**
 * job_events is the durable half of streaming. Persist here FIRST, then publish
 * to the bus — that ordering is the whole reason reconnect, refresh and
 * multi-tab work without any extra machinery (§8).
 */
import type { JobEvent, JobEventData } from "@/lib/types";
import { db, unwrap } from "./supabase";

type Row = { job_id: string; seq: number; type: string; data: JobEventData; created_at: string };

const toEvent = (r: Row): JobEvent => ({ seq: r.seq, jobId: r.job_id, ...r.data });

export interface PendingEvent {
  jobId: string;
  seq: number;
  data: JobEventData;
}

/**
 * `unique (job_id, seq)` rejected the write — someone else is numbering events
 * for this job.
 *
 * Its own class because it is the one insert failure that is recoverable: the
 * event is fine, the number is taken, and the emitter can pick another. Every
 * other error means Postgres is unreachable, which is not.
 */
export class SeqTakenError extends Error {
  constructor(readonly seq: number) {
    super(`event seq ${seq} is already taken`);
    this.name = "SeqTakenError";
  }
}

/** PostgREST surfaces a unique violation as SQLSTATE 23505. */
function raise(what: string, error: { message: string; code?: string }, seq: number): never {
  if (error.code === "23505") throw new SeqTakenError(seq);
  throw new Error(`${what}: ${error.message}`);
}

export async function append(event: PendingEvent): Promise<void> {
  const res = await db()
    .from("job_events")
    .insert({ job_id: event.jobId, seq: event.seq, type: event.data.type, data: event.data });
  if (res.error) raise("event.append", res.error, event.seq);
}

/** Batched insert — text_delta rows are coalesced on a ~250ms flush (§8). */
export async function appendMany(events: PendingEvent[]): Promise<void> {
  if (events.length === 0) return;
  const res = await db()
    .from("job_events")
    .insert(events.map((e) => ({ job_id: e.jobId, seq: e.seq, type: e.data.type, data: e.data })));
  // The batch is one statement, so one taken number rejects all of it; the first
  // is the one the caller has to renumber from.
  if (res.error) raise("event.appendMany", res.error, events[0].seq);
}

/** Replay for a reconnecting EventSource: everything after its Last-Event-ID. */
export async function listAfter(jobId: string, afterSeq: number): Promise<JobEvent[]> {
  const res = await db()
    .from("job_events")
    .select()
    .eq("job_id", jobId)
    .gt("seq", afterSeq)
    .order("seq", { ascending: true });
  return unwrap<Row[]>(res, "event.listAfter").map(toEvent);
}

/** Seeds the in-memory seq counter when a worker picks up (or resumes) a job. */
export async function maxSeq(jobId: string): Promise<number> {
  const res = await db()
    .from("job_events")
    .select("seq")
    .eq("job_id", jobId)
    .order("seq", { ascending: false })
    .limit(1);
  const rows = unwrap<{ seq: number }[]>(res, "event.maxSeq");
  return rows[0]?.seq ?? 0;
}
