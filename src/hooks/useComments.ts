"use client";

/**
 * Notes on the page (§11).
 *
 * A note is durable and a pin is not, so this is a TanStack Query concern and
 * `usePins` is not (§13). The two meet in one place: anything carrying open
 * notes gets pinned on load, because a note that isn't attached to the message
 * can't reach the model.
 *
 * A note anchors to a SECTION or to one ELEMENT inside it. Both live in the
 * same key space as pins — `refKey` of a whole-section ref is the bare slug —
 * which is why none of this needs a translation layer.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Comment, ElementRef, PickedTarget, SectionInfo } from "@/lib/types";

export const COMMENTS_KEY = ["comments"] as const;

/** The whole-section pin for a section, built without touching the DOM. */
function sectionTarget(section: SectionInfo): PickedTarget {
  return {
    key: section.slug,
    ref: {
      sectionSlug: section.slug,
      path: [],
      tag: "",
      text: "",
      attrs: {},
      nth: 0,
      trail: "",
      label: section.label,
    },
    sectionSlug: section.slug,
    sectionLabel: section.label,
    file: section.file,
  };
}

/**
 * Which pin a note is shown on.
 *
 * The finest thing that is ACTUALLY pinned: its element, if that element's pin
 * is in the set — otherwise the section it lives in. The fallback is not a
 * detail. The agent rewrites a section, the pinned element inside it stops
 * existing, and `downgradePins` turns that pin into a section pin (§11); an
 * exact-key-only rule would leave the note counted against a key nothing is
 * pinned at, so it would still ride along on send while being invisible in the
 * composer. Notes are the one thing in the studio that must never go quiet.
 */
export function noteKey(comment: Comment, pinned: ReadonlySet<string>): string {
  return comment.targetKey && pinned.has(comment.targetKey)
    ? comment.targetKey
    : comment.sectionSlug;
}

/** Every open note, grouped onto the pin that shows it. Oldest first within each. */
export function bucketNotes(
  comments: readonly Comment[],
  pinned: ReadonlySet<string>,
): Map<string, Comment[]> {
  const out = new Map<string, Comment[]>();
  for (const comment of comments) {
    const key = noteKey(comment, pinned);
    const bucket = out.get(key);
    if (bucket) bucket.push(comment);
    else out.set(key, [comment]);
  }
  return out;
}

/** What the chip and the marker badge count. */
export function countByTarget(buckets: ReadonlyMap<string, Comment[]>): Map<string, number> {
  return new Map([...buckets].map(([key, notes]) => [key, notes.length]));
}

/**
 * Everything carrying open notes, as pin-set entries.
 *
 * An element note brings back the ELEMENT — `target_ref` holds enough to re-pin
 * it, so a note left on a heading yesterday comes back on that heading rather
 * than on the whole section. If the element is gone the preview says so and the
 * pin downgrades itself, which is the same path an agent rewrite already takes.
 *
 * Order follows `sections` — the page's order — rather than the order the notes
 * were written in, so the chips read the way the page does. A note whose section
 * the studio hasn't heard of yet is skipped; the server drops the truly orphaned
 * ones, and this covers the moment before `ready` lands.
 */
export function targetsWithNotes(
  comments: readonly Comment[],
  sections: readonly SectionInfo[],
): PickedTarget[] {
  const out: PickedTarget[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    for (const comment of comments) {
      if (comment.sectionSlug !== section.slug) continue;
      const target =
        comment.targetKey && comment.targetRef
          ? elementTarget(section, comment.targetKey, comment.targetRef)
          : sectionTarget(section);
      // Two notes on one heading pin it once, and a section note alongside an
      // element note pins both — one entry per key, in page order.
      if (seen.has(target.key)) continue;
      seen.add(target.key);
      out.push(target);
    }
  }

  return out;
}

function elementTarget(section: SectionInfo, key: string, ref: ElementRef): PickedTarget {
  return {
    key,
    // `attrs` is preview-side only and never stored, so it comes back empty.
    // That costs a little signature score if the path has moved; the path
    // itself, the tag and the text — the parts that do the work — are all here.
    ref: { ...ref, attrs: ref.attrs ?? {} },
    sectionSlug: section.slug,
    sectionLabel: section.label,
    file: section.file,
  };
}

export function useComments() {
  return useQuery({
    queryKey: COMMENTS_KEY,
    queryFn: () => api.get<Comment[]>("/api/comments"),
  });
}

/**
 * The wire form of the thing a note is on. `attrs` is dropped for the same
 * reason the chat route drops it: nothing downstream renders it, so sending it
 * would only widen what ends up in the database.
 */
export interface NoteTarget {
  key: string;
  label: string;
  ref: Omit<ElementRef, "attrs">;
}

export interface AddCommentInput {
  sectionSlug: string;
  body: string;
  /** Omitted for a note on the whole section. */
  target?: NoteTarget;
}

/** A pin, as the note endpoint wants it. A whole-section pin sends no target. */
export function noteTargetFor(pin: PickedTarget): NoteTarget | undefined {
  if (pin.ref.path.length === 0) return undefined;
  // Listed rather than spread-minus-attrs, the same way `toWire` does it: the
  // fields that cross the wire should be visible in one place.
  const { sectionSlug, path, tag, text, label, trail, nth } = pin.ref;
  return { key: pin.key, label, ref: { sectionSlug, path, tag, text, label, trail, nth } };
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddCommentInput) => api.post<Comment>("/api/comments", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMMENTS_KEY }),
  });
}

export function useResolveComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/api/comments/${id}/resolve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMMENTS_KEY }),
  });
}
