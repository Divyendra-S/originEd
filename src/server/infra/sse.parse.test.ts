/**
 * The parser that decides whether the agent can hear Gemini at all.
 *
 * The CRLF case is not hypothetical: §6 specified `\n\n`, the live endpoint
 * sends `\r\n\r\n`, and the failure mode is a 200 response that parses to zero
 * events. These tests pin the real wire format.
 */
import { describe, expect, it } from "vitest";
import { createSseParser, frameData, streamJson } from "./sse.parse";

const stream = (...chunks: string[]): ReadableStream<Uint8Array> => {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
};

const collect = async (s: ReadableStream<Uint8Array>) => {
  const out: unknown[] = [];
  for await (const v of streamJson(s)) out.push(v);
  return out;
};

describe("createSseParser", () => {
  it("splits CRLF-terminated frames — the format Gemini actually sends", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":1}\r\n\r\ndata: {"a":2}\r\n\r\n')).toEqual(['data: {"a":1}', 'data: {"a":2}']);
  });

  it("splits LF-terminated frames too", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":1}\n\n')).toEqual(['data: {"a":1}']);
  });

  it("holds a partial frame until the rest arrives", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":')).toEqual([]);
    expect(p.feed("1}\r\n")).toEqual([]);
    expect(p.feed("\r\n")).toEqual(['data: {"a":1}']);
  });

  it("survives a chunk boundary that lands INSIDE the CRLF pair", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":1}\r')).toEqual([]);
    expect(p.feed('\n\r\ndata: {"a":2}\r\n\r\n')).toEqual(['data: {"a":1}', 'data: {"a":2}']);
  });

  it("yields a trailing frame the server never terminated", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":1}')).toEqual([]);
    expect(p.end()).toEqual(['data: {"a":1}']);
  });

  it("end() is empty when everything was already drained", () => {
    const p = createSseParser();
    p.feed('data: {"a":1}\r\n\r\n');
    expect(p.end()).toEqual([]);
  });
});

describe("frameData", () => {
  it("strips the `data: ` prefix", () => {
    expect(frameData('data: {"a":1}')).toBe('{"a":1}');
  });

  it("accepts `data:` with no space, per the spec", () => {
    expect(frameData('data:{"a":1}')).toBe('{"a":1}');
  });

  it("rejoins a payload split across several data lines", () => {
    expect(frameData("data: {\ndata:   \"a\": 1\ndata: }")).toBe('{\n  "a": 1\n}');
  });

  it("ignores comments and non-data fields", () => {
    expect(frameData(": keep-alive")).toBeNull();
    expect(frameData("event: message\nid: 7")).toBeNull();
  });
});

describe("streamJson", () => {
  it("parses a CRLF stream arriving in awkward chunks", async () => {
    expect(await collect(stream('data: {"n":1}\r\n\r\ndata: {"n"', ':2}\r\n\r\ndata: {"n":3}\r\n\r\n'))).toEqual([
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);
  });

  it("does not lose the last frame when the server closes without a blank line", async () => {
    expect(await collect(stream('data: {"n":1}'))).toEqual([{ n: 1 }]);
  });

  it("throws on a malformed frame rather than silently skipping it", async () => {
    await expect(collect(stream("data: {not json}\r\n\r\n"))).rejects.toThrow();
  });

  it("stops when the signal aborts", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(collect2(stream('data: {"n":1}\r\n\r\n'), ac.signal)).rejects.toThrow();
  });
});

async function collect2(s: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const out: unknown[] = [];
  for await (const v of streamJson(s, signal)) out.push(v);
  return out;
}
