"use client";

/**
 * Notes on sections (§11).
 *
 * A note is durable and a pin is not, so this is a TanStack Query concern and
 * `usePins` is not (§13). The two meet in one place: a section with open notes
 * gets pinned on load, because a note that isn't attached to the message can't
 * reach the model.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Comment, PickedTarget, SectionInfo } from "@/lib/types";

export const COMMENTS_KEY = ["comments"] as const;

/** What the marker's badge counts, per section. */
export function countBySection(comments: readonly Comment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    counts.set(comment.sectionSlug, (counts.get(comment.sectionSlug) ?? 0) + 1);
  }
  return counts;
}

/**
 * The sections that carry open notes, as pin-set entries.
 *
 * Order follows `sections` — the page's order — rather than the order the notes
 * were written in, so the chips read the way the page does. A note whose section
 * the studio hasn't heard of yet is skipped; the server drops the truly orphaned
 * ones, and this covers the moment before `ready` lands.
 */
export function sectionsWithNotes(
  comments: readonly Comment[],
  sections: readonly SectionInfo[],
): SectionInfo[] {
  const slugs = new Set(comments.map((c) => c.sectionSlug));
  return sections.filter((s) => slugs.has(s.slug));
}

/**
 * The same sections, as pin-set entries.
 *
 * A whole-section pin's key is its slug, so this needs no lookup and no
 * translation — the note's `section_slug` and the pin's key are the same string.
 */
export function targetsWithNotes(
  comments: readonly Comment[],
  sections: readonly SectionInfo[],
): PickedTarget[] {
  return sectionsWithNotes(comments, sections).map((s) => ({
    key: s.slug,
    ref: {
      sectionSlug: s.slug,
      path: [],
      tag: "",
      text: "",
      attrs: {},
      nth: 0,
      trail: "",
      label: s.label,
    },
    sectionSlug: s.slug,
    sectionLabel: s.label,
    file: s.file,
  }));
}

export function useComments() {
  return useQuery({
    queryKey: COMMENTS_KEY,
    queryFn: () => api.get<Comment[]>("/api/comments"),
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { sectionSlug: string; body: string }) =>
      api.post<Comment>("/api/comments", input),
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
