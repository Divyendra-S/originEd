/**
 * Layer 3 · infra — serialising our job events onto the wire (§8).
 *
 * Separate from the route so it can be tested without a server, and because SSE
 * has two rules that are easy to break by string-concatenating inline:
 *   · every line of a multi-line payload needs its own `data:` prefix, and
 *   · a frame is only dispatched once a BLANK line closes it.
 * A stray newline inside `data:` silently truncates the event at the client.
 */
import type { JobEvent, JobEventData } from "@/lib/types";

/** A framed event. `id:` is what the browser echoes back as `Last-Event-ID`. */
export function frame(event: JobEvent): string {
  const { seq, jobId: _jobId, ...data } = event;
  void _jobId; // the client already knows which job it opened
  return `id: ${seq}\n${frameless(data)}`;
}

/**
 * The same frame with no `id:` line — for a synthetic event the client must not
 * treat as a resume point (see the terminal-job fallback in the stream route).
 */
export function frameless(data: JobEventData): string {
  return `event: ${data.type}\n${dataLines(JSON.stringify(data))}\n`;
}

function dataLines(payload: string): string {
  // JSON.stringify escapes newlines, so this is belt-and-braces — but the cost
  // of being wrong here is a stream that dies on one unlucky message.
  return payload
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n")
    .concat("\n");
}

export const COMMENT_PING = ": ping\n\n";
export const COMMENT_OPEN = ": open\n\n";

/** Sets the browser's auto-reconnect backoff. Sent once, when the stream opens. */
export function retry(ms: number): string {
  return `retry: ${ms}\n\n`;
}
