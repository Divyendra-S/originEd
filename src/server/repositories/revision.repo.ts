/**
 * One table, two features: the diff view and undo (§7, §12). Because we store
 * `before` and `after` for every write, a finished job's diff is a pure function
 * of these rows — no git, no re-reading the filesystem, stable forever.
 */
import type { FileOp, FileRevision } from "@/lib/types";
import { db, unwrap } from "./supabase";

type Row = {
  id: number;
  job_id: string;
  seq: number;
  path: string;
  op: FileOp;
  before: string | null;
  after: string | null;
  reverted_at: string | null;
  created_at: string;
};

const toRevision = (r: Row): FileRevision => ({
  id: r.id,
  jobId: r.job_id,
  seq: r.seq,
  path: r.path,
  op: r.op,
  before: r.before,
  after: r.after,
  revertedAt: r.reverted_at,
  createdAt: r.created_at,
});

export async function append(input: {
  jobId: string;
  seq: number;
  path: string;
  op: FileOp;
  before: string | null;
  after: string | null;
}): Promise<void> {
  const res = await db().from("file_revisions").insert({
    job_id: input.jobId,
    seq: input.seq,
    path: input.path,
    op: input.op,
    before: input.before,
    after: input.after,
  });
  if (res.error) throw new Error(`revision.append: ${res.error.message}`);
}

export async function listByJob(jobId: string): Promise<FileRevision[]> {
  const res = await db()
    .from("file_revisions")
    .select()
    .eq("job_id", jobId)
    .order("seq", { ascending: true });
  return unwrap<Row[]>(res, "revision.listByJob").map(toRevision);
}

export async function markReverted(jobId: string): Promise<void> {
  const res = await db()
    .from("file_revisions")
    .update({ reverted_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .is("reverted_at", null);
  if (res.error) throw new Error(`revision.markReverted: ${res.error.message}`);
}

/**
 * Path + op only, for every job in a chat at once. The ChangeCard needs the
 * shape of a change, not its bytes — selecting `before`/`after` here would ship
 * ~20KB per edit down the transcript route for a card that shows a filename.
 */
export interface RevisionStub {
  jobId: string;
  seq: number;
  path: string;
  op: FileOp;
  revertedAt: string | null;
}

export async function summaryByJobs(jobIds: string[]): Promise<RevisionStub[]> {
  if (jobIds.length === 0) return [];
  const res = await db()
    .from("file_revisions")
    .select("job_id,seq,path,op,reverted_at")
    .in("job_id", jobIds)
    .order("seq", { ascending: true });
  type Stub = Pick<Row, "job_id" | "seq" | "path" | "op" | "reverted_at">;
  return unwrap<Stub[]>(res, "revision.summaryByJobs").map((r) => ({
    jobId: r.job_id,
    seq: r.seq,
    path: r.path,
    op: r.op,
    revertedAt: r.reverted_at,
  }));
}

/**
 * Revisions newer than `afterId` that still stand on any of `paths`.
 *
 * This is the guard on restore. `id` is a bigserial, so "newer" is exact and
 * needs no clock. If a later job edited hero.tsx and has not itself been
 * reverted, undoing an earlier job would write a stale `before` over that work
 * with nothing to get it back from — so we refuse instead (§12).
 */
export async function laterActive(afterId: number, paths: string[]): Promise<FileRevision[]> {
  if (paths.length === 0) return [];
  const res = await db()
    .from("file_revisions")
    .select()
    .gt("id", afterId)
    .in("path", paths)
    .is("reverted_at", null)
    .order("id", { ascending: true });
  return unwrap<Row[]>(res, "revision.laterActive").map(toRevision);
}
