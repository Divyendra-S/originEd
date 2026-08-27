import { QueryClient } from "@tanstack/react-query";

/**
 * TanStack Query owns SNAPSHOTS only. In-flight job state lives in the SSE hook's
 * reducer and is handed over in a single invalidation on `done` (§13). Do not try
 * to model the stream as a query — it is a push channel, not a fetch.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

let browserClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}
