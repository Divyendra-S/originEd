/**
 * §12 — the receipt. Everything here is a pure function of `file_revisions`:
 * no git, no re-reading the filesystem, no build artifacts. A finished job's
 * diff is therefore stable forever, even after ten later jobs edit the same
 * file. That property is the whole reason we store `before` AND `after`.
 *
 * Three things live here:
 *
 *   summarize()  level 2 — what changed, by section. Rides with the transcript.
 *   forJob()     level 3 — the same thing with the patch math done.
 *   restore()    the inverse — replay the job backwards.
 */
import { structuredPatch } from "diff";
import type { ChangedFile, DiffHunk, FileDiff, FileOp, JobChanges, JobDiff } from "@/lib/types";
import * as fs from "@/server/infra/workspace.fs";
import * as revisionRepo from "@/server/repositories/revision.repo";
import { labelForSlug, slugForFile } from "@/workspace/manifest";

/** Restore refused because undoing this job would destroy newer work (§12). */
export class RestoreConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreConflict";
  }
}

interface RevisionLike {
  seq: number;
  path: string;
  before: string | null;
  after: string | null;
}

export interface CollapsedFile {
  path: string;
  op: FileOp;
  before: string | null;
  after: string | null;
}

/**
 * Many revisions → one entry per path: first `before`, last `after`.
 *
 * If the agent edits hero.tsx four times in one job you want ONE row showing
 * where the file started and where it ended, not the agent's intermediate
 * drafts. `Map` preserves insertion order, so files come back in the order they
 * were first touched — more useful than alphabetical, and it matches the order
 * the ToolCards scrolled past in.
 */
export function collapse(revisions: readonly RevisionLike[]): CollapsedFile[] {
  const byPath = new Map<string, { path: string; before: string | null; after: string | null }>();

  for (const rev of [...revisions].sort((a, b) => a.seq - b.seq)) {
    const seen = byPath.get(rev.path);
    if (seen) seen.after = rev.after;
    else byPath.set(rev.path, { path: rev.path, before: rev.before, after: rev.after });
  }

  return (
    [...byPath.values()]
      // A file created and deleted in the same job left no trace, and neither did
      // an edit the agent talked itself out of. Showing either is showing noise.
      .filter((f) => f.before !== f.after)
      // The op is DERIVED, never carried over from a revision row: a file that was
      // created and then edited twice is, on net, a create.
      .map((f) => ({ ...f, op: netOp(f.before, f.after) }))
  );
}

function netOp(before: string | null, after: string | null): FileOp {
  if (before === null) return "create";
  if (after === null) return "delete";
  return "update";
}

/** Path → the two names a human recognises. Unmapped files keep their path. */
function identify(path: string): Pick<ChangedFile, "sectionSlug" | "label"> {
  const sectionSlug = slugForFile(path);
  return { sectionSlug, label: sectionSlug ? labelForSlug(sectionSlug) : null };
}

function toFileDiff(file: CollapsedFile): FileDiff {
  const patch = structuredPatch(file.path, file.path, file.before ?? "", file.after ?? "", "", "", {
    context: 3,
  });

  const hunks: DiffHunk[] = patch.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: [...h.lines],
  }));

  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      // Context lines start with a space; "\ No newline at end of file" with a
      // backslash. Only these two prefixes count.
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }

  return { path: file.path, op: file.op, ...identify(file.path), hunks, added, removed };
}

/** True only when the job wrote something and every one of those writes is undone. */
function isReverted(revisions: readonly { revertedAt: string | null }[]): boolean {
  return revisions.length > 0 && revisions.every((r) => r.revertedAt !== null);
}

// ── level 2 ───────────────────────────────────────────────────────────────────

/**
 * Change summaries for a whole chat in one query. Because this deliberately does
 * not select the file bodies, it cannot tell that a job's net effect was nothing
 * — a job that edited hero.tsx and then put it back still shows here as one
 * changed file. Clicking Review reads the real thing and shows no hunks. That
 * trade is worth it: the alternative is shipping every file body with the
 * transcript to catch a case the agent almost never produces.
 */
export async function summarize(jobIds: string[]): Promise<JobChanges[]> {
  const stubs = await revisionRepo.summaryByJobs(jobIds);
  const byJob = new Map<string, JobChanges>();

  for (const stub of stubs) {
    let entry = byJob.get(stub.jobId);
    if (!entry) {
      entry = { jobId: stub.jobId, files: [], reverted: true };
      byJob.set(stub.jobId, entry);
    }
    if (stub.revertedAt === null) entry.reverted = false;
    if (!entry.files.some((f) => f.path === stub.path)) {
      entry.files.push({ path: stub.path, op: stub.op, ...identify(stub.path) });
    }
  }

  return [...byJob.values()];
}

// ── level 3 ───────────────────────────────────────────────────────────────────

export async function forJob(jobId: string): Promise<JobDiff> {
  const revisions = await revisionRepo.listByJob(jobId);
  return {
    jobId,
    files: collapse(revisions).map(toFileDiff),
    reverted: isReverted(revisions),
  };
}

// ── restore ───────────────────────────────────────────────────────────────────

/**
 * Per-turn checkpointing, and it falls out of a table we needed anyway.
 *
 * Replayed in REVERSE seq, one revision at a time rather than from the collapsed
 * view: walking backwards through every intermediate `before` lands on the same
 * bytes and needs no special reasoning about files the job created, then edited,
 * then renamed around. HMR undoes the preview the same way it did the edit.
 */
export async function restore(jobId: string): Promise<JobDiff> {
  const revisions = await revisionRepo.listByJob(jobId);
  if (revisions.length === 0) throw new RestoreConflict("this turn did not change any files");

  // Idempotent: a double-click, or two tabs, must not replay a second time.
  if (isReverted(revisions)) return forJob(jobId);

  await assertNothingNewerStands(revisions);

  for (const rev of [...revisions].sort((a, b) => b.seq - a.seq)) {
    if (rev.before === null) {
      // The job created this file; putting it back means removing it. Tolerate a
      // file that is already gone — the end state is what we are asserting.
      try {
        await fs.deleteFile(rev.path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    } else {
      await fs.writeFile(rev.path, rev.before);
    }
  }

  await revisionRepo.markReverted(jobId);
  return forJob(jobId);
}

async function assertNothingNewerStands(
  revisions: readonly { id: number; path: string }[],
): Promise<void> {
  const newest = Math.max(...revisions.map((r) => r.id));
  const paths = [...new Set(revisions.map((r) => r.path))];
  const later = await revisionRepo.laterActive(newest, paths);
  if (later.length === 0) return;

  const blocked = [...new Set(later.map((r) => identify(r.path).label ?? r.path))];
  throw new RestoreConflict(
    `A later turn changed ${blocked.join(", ")}. Restore that turn first — undoing this one now would overwrite it.`,
  );
}
