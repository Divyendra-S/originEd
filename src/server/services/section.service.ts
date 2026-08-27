/**
 * Sections as the studio talks about them. `manifest.ts` is the source of truth
 * (§9) — there is no `sections` table, because the agent edits the manifest
 * directly and a second copy in Postgres would drift within one job.
 */
import type { Attachment, AttachedSection, ElementRef, SectionInfo } from "@/lib/types";
import { readFileIfExists } from "@/server/infra/workspace.fs";
import * as commentRepo from "@/server/repositories/comment.repo";
import { sections } from "@/workspace/manifest";

export function list(): SectionInfo[] {
  return sections.map((s) => ({ slug: s.slug, label: s.label, file: s.file }));
}

export function bySlug(slug: string): SectionInfo | null {
  return list().find((s) => s.slug === slug) ?? null;
}

/** Fill in the fields the wire form leaves out. `attrs` is preview-side only. */
function toRef(attachment: Exclude<Attachment, string>): ElementRef {
  return { ...attachment, attrs: {} };
}

/**
 * THE headline feature's foundation (§11). Reads each pinned section's file
 * VERBATIM, right now, so the job's context is exactly the bytes the user was
 * looking at when they hit send — not whatever the file says by the time the
 * agent gets around to reading it.
 *
 * The section's open notes are frozen in the same breath, for the same reason:
 * `jobs.context` should hold what the user was looking at, and a note written
 * thirty seconds later belongs to the next turn (§11).
 *
 * De-duped by SECTION, not by target. One `<attached-section>` per section
 * however many elements are pinned inside it — the hero is 19KB, and sending it
 * twice because two of its buttons are pinned is exactly the token waste §14
 * risk 8 is about. The elements ride along in `targets` instead.
 *
 * Unknown slugs are dropped rather than thrown: a section the agent deleted
 * mid-session should not turn the user's next message into a 500.
 */
export async function snapshot(attachments: readonly Attachment[]): Promise<AttachedSection[]> {
  if (attachments.length === 0) return [];

  const order: string[] = [];
  const targets = new Map<string, ElementRef[]>();
  for (const attachment of attachments) {
    const slug = typeof attachment === "string" ? attachment : attachment.sectionSlug;
    let bucket = targets.get(slug);
    if (!bucket) {
      bucket = [];
      targets.set(slug, bucket);
      order.push(slug);
    }
    if (typeof attachment !== "string") bucket.push(toRef(attachment));
  }

  // One query for the whole open set, then bucketed — a note is a sentence, and
  // one round trip beats one per pinned section.
  //
  // Bucketed by SECTION even for a note left on one element inside it, which
  // deliberately disagrees with the chip badge in the composer (that one is
  // exact-key). The badge answers "what is on this chip"; this answers "what
  // does the model need to know about this file", and a note must not be
  // orphaned by which of the two the user happened to pin. The element it was
  // on rides along as `label`.
  const notes = new Map<string, AttachedSection["comments"]>();
  for (const comment of await commentRepo.listOpen()) {
    const bucket = notes.get(comment.sectionSlug);
    const entry = {
      id: comment.id,
      body: comment.body,
      status: comment.status,
      // Omitted, not empty — a whole-section note has to render exactly as it
      // did before notes could land on elements.
      ...(comment.targetLabel ? { label: comment.targetLabel } : {}),
    };
    if (bucket) bucket.push(entry);
    else notes.set(comment.sectionSlug, [entry]);
  }

  const out: AttachedSection[] = [];
  for (const slug of order) {
    const section = bySlug(slug);
    if (!section) continue;
    const source = await readFileIfExists(section.file);
    if (source === null) continue;
    const pinned = targets.get(slug) ?? [];
    out.push({
      sectionSlug: section.slug,
      label: section.label,
      file: section.file,
      source,
      comments: notes.get(section.slug) ?? [],
      // Omitted, not empty: a whole-section pin has to serialise and render
      // byte-identically to how it did before elements existed.
      ...(pinned.length > 0 ? { targets: pinned } : {}),
    });
  }

  return out;
}
