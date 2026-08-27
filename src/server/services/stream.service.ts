/**
 * What an SSE connection needs, and nothing else. The route owns the HTTP
 * mechanics; this owns the guarantee underneath them.
 *
 * `replay` flushes the running job's coalesced text batch BEFORE querying, which
 * is what makes the §8 contract actually hold. Without it, a client reconnecting
 * mid-job replays from Postgres, misses the tokens still sitting in the
 * emitter's 250ms buffer, and resumes from the next flushed batch — a silent
 * hole in the middle of a sentence.
 */
import type { JobEvent, JobStatus } from "@/lib/types";
import { subscribe } from "@/server/infra/event-bus";
import * as eventRepo from "@/server/repositories/event.repo";
import * as jobRepo from "@/server/repositories/job.repo";
import { flushJob } from "./job-emitter";

export { subscribe };

export const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

export async function status(jobId: string): Promise<JobStatus | null> {
  return (await jobRepo.byId(jobId))?.status ?? null;
}

export async function exists(jobId: string): Promise<boolean> {
  return (await jobRepo.byId(jobId)) !== null;
}

export async function replay(jobId: string, afterSeq: number): Promise<JobEvent[]> {
  await flushJob(jobId);
  return eventRepo.listAfter(jobId, afterSeq);
}
