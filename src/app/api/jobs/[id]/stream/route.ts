/**
 * The SSE endpoint (§8).
 *
 * Two orderings make this correct, and both are easy to get backwards:
 *
 *  1. SUBSCRIBE BEFORE REPLAYING. If you query `job_events` first and subscribe
 *     after, every event published in between is lost forever — the query
 *     already missed it and the subscription did not exist yet. So: subscribe
 *     into a buffer, replay from Postgres, then drain the buffer discarding
 *     anything at or below the last seq already sent.
 *  2. Events are persisted before they are published (see job-emitter), which is
 *     what makes the replay half trustworthy in the first place.
 *
 * `Last-Event-ID` is sent automatically by EventSource on reconnect, so a
 * dropped connection resumes exactly where it left off.
 */
import type { NextRequest } from "next/server";
import type { JobEvent } from "@/lib/types";
import { COMMENT_OPEN, COMMENT_PING, frame, frameless, retry } from "@/server/infra/sse.format";
import * as stream from "@/server/services/stream.service";
import { fail } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 15_000;

function lastEventIdOf(request: NextRequest): number {
  const header = request.headers.get("last-event-id");
  const query = request.nextUrl.searchParams.get("lastEventId");
  const parsed = Number.parseInt(header ?? query ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/stream">,
): Promise<Response> {
  const { id } = await ctx.params;

  if (!(await stream.exists(id))) return fail("job not found", 404);

  const from = lastEventIdOf(request);
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let sawDone = false;
      let lastSent = from;
      let buffering = true;
      const buffered: JobEvent[] = [];
      let ping: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;

      function write(chunk: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client hung up between our check and the enqueue.
          closed = true;
        }
      }

      function close() {
        if (closed) return;
        closed = true;
        if (ping) clearInterval(ping);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime; nothing to do.
        }
      }

      function push(event: JobEvent) {
        if (event.seq <= lastSent) return; // replayed already, or a duplicate
        lastSent = event.seq;
        write(frame(event));
        if (event.type === "done") {
          sawDone = true;
          close();
        }
      }

      // (1) subscribe first, buffering until the replay has been written out
      unsubscribe = stream.subscribe(id, (event) => {
        if (buffering) buffered.push(event);
        else push(event);
      });

      request.signal.addEventListener("abort", close, { once: true });

      // `retry` sets the browser's reconnect backoff; the comment flushes headers
      // through any proxy that would otherwise sit on them.
      write(retry(3000) + COMMENT_OPEN);

      try {
        for (const event of await stream.replay(id, from)) push(event);
      } catch (err) {
        console.error("[stream] replay failed", err);
        write(frameless({ type: "error", message: "replay failed" }));
      }

      // (2) go live, draining anything that landed during the replay
      buffering = false;
      buffered.sort((a, b) => a.seq - b.seq);
      for (const event of buffered) push(event);

      if (closed) return;

      // A job that finished before this connection opened will never publish
      // anything, so nothing above would ever close the stream. Re-read the row,
      // pick up a `done` that raced in, and synthesise one if the job died
      // without emitting (a hard crash mid-write).
      const current = await stream.status(id);
      if (current && stream.TERMINAL.has(current)) {
        for (const event of await stream.replay(id, lastSent)) push(event);
        if (!sawDone && !closed) {
          // No `id:` line — a synthetic frame must not move Last-Event-ID.
          write(frameless({ type: "done", status: current, filesChanged: 0 }));
          close();
        }
        return;
      }

      ping = setInterval(() => write(COMMENT_PING), PING_MS);
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer proxied responses by default, which turns a
      // token stream into one big blob delivered at the end.
      "x-accel-buffering": "no",
    },
  });
}
