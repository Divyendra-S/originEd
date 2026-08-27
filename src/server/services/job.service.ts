/**
 * The worker. Owns the job lifecycle from §2.3 and nothing else — it does not
 * know what an agent does, only that it emits events and eventually returns or
 * throws.
 *
 * Every exit path is terminal and observable: the row gets a final status AND a
 * `done` event goes out, in that order. A client watching the stream must never
 * be left waiting on a job the database already considers finished.
 */
import type { JobStatus } from "@/lib/types";
import * as queue from "@/server/infra/job-queue";
import * as jobRepo from "@/server/repositories/job.repo";
import * as messageRepo from "@/server/repositories/message.repo";
import * as agent from "./agent.service";
import * as commentService from "./comment.service";
import { createEmitter } from "./job-emitter";

export const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

/** Queues the job. Returns immediately — POST /api/chat must not await the agent. */
export function start(jobId: string): void {
  queue.enqueue(jobId, (signal) => execute(jobId, signal));
}

async function execute(jobId: string, signal: AbortSignal): Promise<void> {
  const job = await jobRepo.byId(jobId);
  if (!job) {
    console.error(`[job.service] job ${jobId} vanished before it ran`);
    return;
  }
  if (TERMINAL.has(job.status)) return; // cancelled while it sat in the queue

  const emitter = await createEmitter(jobId);

  try {
    await jobRepo.markRunning(jobId);
    await emitter.emit({ type: "status", status: "running" });

    const result = await agent.run({ job, emit: emitter.emit, signal });

    // Flush before persisting the message: the transcript and the replayed
    // stream should never disagree about what the model said.
    await emitter.flush();
    if (result.text.trim().length > 0) {
      await messageRepo.insert({
        chatId: job.chatId,
        role: "model",
        content: { text: result.text },
        jobId,
      });
    }

    await jobRepo.finish(jobId, "succeeded");

    // The notes this turn carried are answered. Best-effort on purpose: the run
    // succeeded, and a failure to tick off a note must not rewrite that verdict
    // into `failed` from inside the try block.
    await commentService
      .resolveForJob(jobId, job.context)
      .catch((err) => console.error(`[job.service] could not resolve notes for ${jobId}`, err));

    await emitter.emit({ type: "done", status: "succeeded", filesChanged: result.filesChanged });
  } catch (err) {
    const cancelled = signal.aborted || err instanceof agent.Cancelled;
    const status: JobStatus = cancelled ? "cancelled" : "failed";
    const message = err instanceof Error ? err.message : String(err);

    try {
      await emitter.flush();
      if (!cancelled) {
        console.error(`[job.service] job ${jobId} failed`, err);
        await emitter.emit({ type: "error", message });
      }
      await jobRepo.finish(jobId, status, cancelled ? null : message);
      await emitter.emit({ type: "done", status, filesChanged: 0 });
    } catch (reportErr) {
      // Postgres is unreachable. Nothing useful is left to do but say so loudly —
      // the SSE client falls back to polling the job row on reconnect.
      console.error(`[job.service] could not report failure for ${jobId}`, reportErr);
    }
  } finally {
    await emitter.dispose();
  }
}

export async function cancel(jobId: string): Promise<{ status: JobStatus }> {
  const job = await jobRepo.byId(jobId);
  if (!job) throw new Error("job not found");
  if (TERMINAL.has(job.status)) return { status: job.status };

  const outcome = queue.cancel(jobId);

  // A running task aborts its own signal and writes its own terminal row through
  // `execute`'s catch. A queued one never gets there, so close it out here.
  if (outcome !== "cancelled-running") {
    const emitter = await createEmitter(jobId);
    await jobRepo.finish(jobId, "cancelled");
    await emitter.emit({ type: "done", status: "cancelled", filesChanged: 0 });
    await emitter.dispose();
  }

  return { status: "cancelled" };
}
