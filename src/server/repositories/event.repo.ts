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

export async function append(event: PendingEvent): Promise<void> {
  const res = await db()
    .from("job_events")
    .insert({ job_id: event.jobId, seq: event.seq, type: event.data.type, data: event.data });
  if (res.error) throw new Error(`event.append: ${res.error.message}`);
}

/** Batched insert — text_delta rows are coalesced on a ~250ms flush (§8). */
export async function appendMany(events: PendingEvent[]): Promise<void> {
  if (events.length === 0) return;
  const res = await db()
    .from("job_events")
    .insert(events.map((e) => ({ job_id: e.jobId, seq: e.seq, type: e.data.type, data: e.data })));
  if (res.error) throw new Error(`event.appendMany: ${res.error.message}`);
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
