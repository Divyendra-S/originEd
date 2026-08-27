import type { AttachedSection, Job, JobStatus } from "@/lib/types";
import { db, unwrap, unwrapMaybe } from "./supabase";

type Row = {
  id: string;
  chat_id: string;
  status: JobStatus;
  prompt: string;
  context: { attachments: AttachedSection[] } | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const toJob = (r: Row): Job => ({
  id: r.id,
  chatId: r.chat_id,
  status: r.status,
  prompt: r.prompt,
  context: r.context,
  error: r.error,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export async function insert(input: {
  chatId: string;
  prompt: string;
  /** The attachment snapshot is frozen HERE, at job creation — see §5. */
  context: { attachments: AttachedSection[] } | null;
}): Promise<Job> {
  const res = await db()
    .from("jobs")
    .insert({ chat_id: input.chatId, prompt: input.prompt, context: input.context, status: "queued" })
    .select()
    .single();
  return toJob(unwrap<Row>(res, "job.insert"));
}

export async function byId(id: string): Promise<Job | null> {
  const res = await db().from("jobs").select().eq("id", id).maybeSingle();
  const row = unwrapMaybe<Row>(res, "job.byId");
  return row ? toJob(row) : null;
}

export async function markRunning(id: string): Promise<void> {
  const res = await db()
    .from("jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id);
  if (res.error) throw new Error(`job.markRunning: ${res.error.message}`);
}

export async function finish(
  id: string,
  status: Extract<JobStatus, "succeeded" | "failed" | "cancelled">,
  error?: string | null,
): Promise<void> {
  const res = await db()
    .from("jobs")
    .update({ status, error: error ?? null, finished_at: new Date().toISOString() })
    .eq("id", id);
  if (res.error) throw new Error(`job.finish: ${res.error.message}`);
}
