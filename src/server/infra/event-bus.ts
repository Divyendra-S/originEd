/**
 * Layer 3 · infra — in-process pub/sub for job events.
 *
 * Stored on `globalThis` on purpose. The agent writes into `src/workspace/`,
 * which is inside the Next app, so Turbopack recompiles and re-evaluates server
 * modules *mid-job*. Plain module-level state gets a fresh empty Map on every
 * HMR pass and every in-flight SSE connection silently goes deaf. (§14, risk 1)
 *
 * Per-process, so: one instance only. Swapping this file for Supabase Realtime
 * is the entire scale-out story (§8).
 */
import type { JobEvent } from "@/lib/types";

type Listener = (event: JobEvent) => void;

interface BusState {
  listeners: Map<string, Set<Listener>>;
}

const KEY = Symbol.for("originEd.eventBus");

function state(): BusState {
  const g = globalThis as unknown as Record<symbol, BusState | undefined>;
  if (!g[KEY]) g[KEY] = { listeners: new Map() };
  return g[KEY];
}

export function publish(event: JobEvent): void {
  const subs = state().listeners.get(event.jobId);
  if (!subs) return;
  for (const listener of subs) {
    // One bad subscriber must not stop the others, or kill the agent loop.
    try {
      listener(event);
    } catch (err) {
      console.error("[event-bus] listener threw", err);
    }
  }
}

/** Returns an unsubscribe function. Callers MUST call it on stream close. */
export function subscribe(jobId: string, listener: Listener): () => void {
  const { listeners } = state();
  let subs = listeners.get(jobId);
  if (!subs) {
    subs = new Set();
    listeners.set(jobId, subs);
  }
  subs.add(listener);

  return () => {
    const current = state().listeners.get(jobId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) state().listeners.delete(jobId);
  };
}

export function subscriberCount(jobId: string): number {
  return state().listeners.get(jobId)?.size ?? 0;
}
