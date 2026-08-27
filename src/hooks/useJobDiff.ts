"use client";

/**
 * §12 levels 2→3. The summary already arrived with the transcript; this is only
 * for the hunks, so it is deliberately lazy — `enabled` stays false until the
 * user actually clicks Review.
 *
 * `staleTime: Infinity` is not a guess. A finished job's diff is computed from
 * `file_revisions`, which is append-only, so it cannot change underneath us. The
 * one thing that does change it is Restore, and that writes the fresh copy in
 * directly rather than refetching.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { JobDiff } from "@/lib/types";

export function useJobDiff(jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["diff", jobId],
    queryFn: () => api.get<JobDiff>(`/api/jobs/${jobId}/diff`),
    enabled: Boolean(jobId) && enabled,
    staleTime: Infinity,
  });
}

export function useRestoreJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => api.post<JobDiff>(`/api/jobs/${jobId}/undo`),
    onSuccess: (diff) => {
      queryClient.setQueryData(["diff", diff.jobId], diff);
      // The transcript carries the `reverted` flag the card reads, so it has to
      // be refetched for the button to stop offering an undo that already ran.
      // Keyed on the prefix so the card never needs to know its own chat id.
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
  });
}
