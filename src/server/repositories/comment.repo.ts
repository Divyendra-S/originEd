import type { Comment, CommentStatus, ElementRef } from "@/lib/types";
import { db, unwrap } from "./supabase";

/** What `target_ref` holds. `attrs` is preview-side only and never stored. */
export type StoredRef = Omit<ElementRef, "attrs">;

type Row = {
  id: string;
  section_slug: string;
  body: string;
  status: CommentStatus;
  job_id: string | null;
  created_at: string;
  resolved_at: string | null;
  /** Null on every row written before notes could land on an element (§11). */
  target_key: string | null;
  target_ref: StoredRef | null;
  target_label: string | null;
};

const toComment = (r: Row): Comment => ({
  id: r.id,
  sectionSlug: r.section_slug,
  body: r.body,
  status: r.status,
  jobId: r.job_id,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
  // The three columns are nullable and nothing was backfilled, so `?? null` is
  // doing real work here: a row from before the migration has no such key at
  // all, and PostgREST simply omits it.
  targetKey: r.target_key ?? null,
  targetRef: r.target_ref ? { ...r.target_ref, attrs: {} } : null,
  targetLabel: r.target_label ?? null,
});

export interface CreateInput {
  sectionSlug: string;
  body: string;
  /** Absent for a note on the whole section — which is the only kind there was. */
  target?: { key: string; ref: StoredRef; label: string };
}

export async function create(input: CreateInput): Promise<Comment> {
  const res = await db()
    .from("comments")
    .insert({
      section_slug: input.sectionSlug,
      body: input.body,
      // Spread rather than three explicit nulls: an insert that names the
      // columns only when there is a target is one that would still have worked
      // the day before they existed.
      ...(input.target
        ? {
            target_key: input.target.key,
            target_ref: input.target.ref,
            target_label: input.target.label,
          }
        : {}),
    })
    .select()
    .single();
  return toComment(unwrap<Row>(res, "comment.create"));
}

/**
 * Every open note, across every section, oldest first.
 *
 * One query rather than one per pinned section: `snapshot` needs the notes for
 * a handful of slugs at once, and a note is a sentence — the whole open set is
 * smaller than a single section's source.
 */
export async function listOpen(): Promise<Comment[]> {
  const res = await db()
    .from("comments")
    .select()
    .eq("status", "open")
    .order("created_at", { ascending: true });
  return unwrap<Row[]>(res, "comment.listOpen").map(toComment);
}

/** The user ticking a note off themselves — no job to credit it to. */
export async function resolve(id: string): Promise<void> {
  const res = await db()
    .from("comments")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (res.error) throw new Error(`comment.resolve: ${res.error.message}`);
}

/**
 * The notes a finished job carried, closed in one statement and stamped with
 * the job that answered them. Ids come from the job's FROZEN context, so a note
 * left while the agent was working is untouched — it belongs to the next turn.
 */
export async function resolveManyForJob(ids: string[], jobId: string): Promise<void> {
  if (ids.length === 0) return;
  const res = await db()
    .from("comments")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), job_id: jobId })
    .in("id", ids)
    .eq("status", "open");
  if (res.error) throw new Error(`comment.resolveManyForJob: ${res.error.message}`);
}
