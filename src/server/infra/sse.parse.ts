/**
 * Layer 3 · infra — the *inbound* SSE parser (§6). `sse.format.ts` is its mirror:
 * that one writes frames for our browser clients, this one reads frames from
 * Gemini. Kept apart because they share a wire format and nothing else.
 *
 * §6 said "split on `\n\n`". Measured against the real endpoint, Gemini
 * terminates frames with **CRLF CRLF**, so that split matches nothing and the
 * parser yields zero events off a perfectly good 200 response — a silent empty
 * reply, not a crash. Normalising `\r\n` to `\n` on the way in is the whole fix,
 * and it is why this is its own tested module instead of ten inline lines.
 */

/** Feed-and-drain parser. Split out from the stream so it is testable with plain strings. */
export function createSseParser() {
  let buffer = "";
  /**
   * A lone trailing `\r`, held back because it may be the first half of a `\r\n`
   * that got split across a chunk boundary. Normalising per-chunk without this
   * lets a frame terminator through as `\r` + `\n`, and the frame after it is
   * never delivered — roughly a one-in-a-few-hundred-stream bug.
   */
  let carry = "";

  /** Pull every *complete* frame out of the buffer; a partial tail stays put. */
  function drain(): string[] {
    const out: string[] = [];
    let i: number;
    while ((i = buffer.indexOf("\n\n")) !== -1) {
      out.push(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
    return out;
  }

  return {
    /** Accepts an arbitrary byte-boundary chunk; returns whole frames only. */
    feed(chunk: string): string[] {
      const raw = carry + chunk;
      if (raw.endsWith("\r")) {
        carry = "\r";
        buffer += raw.slice(0, -1).replace(/\r\n/g, "\n");
      } else {
        carry = "";
        buffer += raw.replace(/\r\n/g, "\n");
      }
      return drain();
    },
    /**
     * End of stream. A server that closes without a trailing blank line still
     * owes us that last frame, so hand it over rather than dropping it.
     */
    end(): string[] {
      const rest = (buffer + carry).trim();
      buffer = "";
      carry = "";
      return rest.length > 0 ? [rest] : [];
    },
  };
}

/**
 * The `data:` payload of one frame, or null for frames we ignore (`: comment`,
 * bare `event:` lines). Per the SSE spec a payload may span several `data:`
 * lines and is rejoined with newlines — Gemini does not do this today, but a
 * parser that assumes one line would corrupt the JSON the day it starts.
 */
export function frameData(frame: string): string | null {
  const lines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) {
      lines.push(line.slice(line.startsWith("data: ") ? 6 : 5));
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Stream a response body as parsed JSON payloads. Malformed frames throw rather
 * than being skipped: a half-parsed model turn is worse than a failed job.
 */
export async function* streamJson<T>(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      signal?.throwIfAborted();
      for (const frame of parser.feed(decoder.decode(value, { stream: true }))) {
        const payload = frameData(frame);
        if (payload !== null && payload !== "[DONE]") yield JSON.parse(payload) as T;
      }
    }
    for (const frame of parser.end()) {
      const payload = frameData(frame);
      if (payload !== null && payload !== "[DONE]") yield JSON.parse(payload) as T;
    }
  } finally {
    reader.releaseLock();
  }
}
