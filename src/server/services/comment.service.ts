/**
 * Notes left on the page (§11).
 *
 * A note is the spatial half of the headline feature. Pinning says "this is
 * what I'm talking about"; a note says WHAT about it — and because it is
 * anchored to the thing rather than typed into the chat, the model receives it
 * inside that section's `<attached-section>` block instead of in a paragraph
 * that names three sections at once.
 *
 * A note anchors to a SECTION or to one element inside it. The element form is
 * the finer one, and `section_slug` is populated for both: the section is the
 * orphan anchor, so an element the agent rewrites away costs the note its
 * "which element" label and nothing more.
 *
 * Notes are durable (Postgres) while pins are session state, which is the whole
 * reason this table exists: you can close the tab mid-thought and the notes are
 * still on the page tomorrow.
 */
import type { Comment, Job } from "@/lib/types";
import * as commentRepo from "@/server/repositories/comment.repo";
import * as sectionService from "./section.service";

/** Long enough for a sentence or three; short enough that it is not a message. */
export const MAX_BODY = 500;

/**
 * Every open note the studio should show.
 *
 * Notes on a section the agent has since deleted are dropped rather than
 * returned — the same rule `snapshot` follows for a pinned slug that no longer
 * exists. They stay in the table; there is just nothing left to anchor them to.
 */
export async function list(): Promise<Comment[]> {
  const live = new Set(sectionService.list().map((s) => s.slug));
  const open = await commentRepo.listOpen();
  return open.filter((c) => live.has(c.sectionSlug));
}

export interface AddInput {
  sectionSlug: string;
  body: string;
  /** The element the note is on. Absent means the whole section. */
  target?: { key: string; ref: commentRepo.StoredRef; label: string };
}

/** Null when the slug is not a section — a 404, not a 500. */
export async function add(input: AddInput): Promise<Comment | null> {
  const body = input.body.trim();
  if (!body) throw new Error("note is empty");
  if (!sectionService.bySlug(input.sectionSlug)) return null;

  // A target with an empty path IS the whole section — `refKey` of it is the
  // bare slug (§11). Storing it as a target would break the one invariant the
  // column rests on, `target_key IS NULL` ⇔ a section note, and would put a
  // redundant "on Hero:" in front of a note that is already on Hero.
  const target = input.target && input.target.ref.path.length > 0 ? input.target : undefined;

  return commentRepo.create({
    sectionSlug: input.sectionSlug,
    body: body.slice(0, MAX_BODY),
    ...(target ? { target } : {}),
  });
}

export async function resolve(id: string): Promise<void> {
  await commentRepo.resolve(id);
}

/**
 * Close the notes a succeeded job carried, and credit them to it.
 *
 * The ids come out of `jobs.context` — the snapshot frozen at send time — so a
 * note written while the agent was working stays open and rides along with the
 * next turn. Resolving by section slug instead would swallow it.
 *
 * Nothing is resolved when a job fails or is cancelled: the notes were not
 * acted on, and losing them to a run that did nothing is worse than repeating
 * them.
 */
export async function resolveForJob(jobId: string, context: Job["context"]): Promise<number> {
  const ids = (context?.attachments ?? []).flatMap((a) =>
    (a.comments ?? []).map((c) => c.id).filter((id): id is string => Boolean(id)),
  );
  await commentRepo.resolveManyForJob(ids, jobId);
  return ids.length;
}
