/**
 * Raw REST against `generativelanguage.googleapis.com` — no SDK, by decision (§0).
 * The entire cost of that is `streamJson` in infra/sse.parse.ts.
 *
 * The key travels in the `x-goog-api-key` HEADER, never `?key=`, so it cannot end
 * up in a proxy log or an error message that quotes the URL.
 */
import { streamJson } from "@/server/infra/sse.parse";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

/**
 * A Gemini content part. `thoughtSignature` is opaque and MUST survive the round
 * trip — see `mergeParts` below for why that shapes this whole file.
 */
export interface Part {
  text?: string;
  functionCall?: FunctionCall;
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> };
  thoughtSignature?: string;
  thought?: boolean;
}

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Usage {
  promptTokenCount: number;
  candidatesTokenCount: number;
}

export interface TurnResult {
  /** The model turn to push back into `contents`, verbatim enough to be legal. */
  parts: Part[];
  calls: FunctionCall[];
  text: string;
  usage: Usage;
  finishReason: string | null;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

interface StreamChunk {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

export function model(): string {
  return process.env.GEMINI_MODEL || "gemini-3.7-flash";
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new GeminiError("GEMINI_API_KEY is not set — the agent cannot run", 0);
  }
  return key;
}

/**
 * Fold streamed parts into a legal model turn.
 *
 * Two rules, both learned from the live API rather than the docs:
 *
 *  1. Text arrives fragmented across chunks and must be coalesced — pushing one
 *     part per fragment produces a bloated, malformed turn (§6.2).
 *  2. A part carrying a `thoughtSignature` is INDIVISIBLE. Echo a `functionCall`
 *     back without its signature and the next request fails hard:
 *     `400 Function call is missing a thought_signature in functionCall parts`.
 *     So coalescing may only ever absorb a fragment that has no signature of its
 *     own — otherwise we would merge a signature away and break the next turn.
 */
export function mergeParts(incoming: Part[]): Part[] {
  const out: Part[] = [];

  for (const part of incoming) {
    if (part.thought) continue; // thought summaries are not ours to echo back
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      last.text !== undefined &&
      last.functionCall === undefined &&
      part.text !== undefined &&
      part.functionCall === undefined &&
      part.thoughtSignature === undefined
    ) {
      last.text += part.text;
    } else {
      out.push({ ...part });
    }
  }

  return out;
}

export interface TurnInput {
  contents: Content[];
  system: string;
  tools: FunctionDeclaration[];
  signal: AbortSignal;
  /** Called for every text fragment, in order, as it lands. */
  onText: (text: string) => Promise<void> | void;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * How long the endpoint may go without sending a single byte before we give up.
 *
 * `fetch` has no timeout of its own, and a request that connects and then goes
 * quiet is indistinguishable from a model that is thinking — so a stalled call
 * used to hang the job forever. Measured on one: `status: running` at 22:19:10,
 * then nothing, until the user pressed Stop 2m24s later. It also parks the
 * serial queue behind it, so the studio stops answering entirely.
 *
 * Inactivity rather than a total budget: the clock restarts on every chunk, so a
 * long answer that is actually arriving is never cut off, and a dead connection
 * is caught in a minute and a half whatever the job's shape.
 */
const STALL_MS = Number(process.env.GEMINI_STALL_MS) || 90_000;

async function post(input: TurnInput, attempt: number): Promise<Response> {
  const thinkingLevel = process.env.GEMINI_THINKING_LEVEL || "low";

  const res = await fetch(`${ENDPOINT}/${model()}:streamGenerateContent?alt=sse`, {
    method: "POST",
    signal: input.signal,
    headers: { "x-goog-api-key": apiKey(), "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: input.contents,
      tools: [{ functionDeclarations: input.tools }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: {
        maxOutputTokens: 65536,
        // Verified shape for the 3.x family: `thinkingLevel` lives INSIDE
        // `thinkingConfig`. At the top level of generationConfig it is a 400.
        thinkingConfig: { thinkingLevel },
      },
    }),
  });

  if (res.ok) return res;

  const body = await res.text();
  let message = body.slice(0, 500);
  try {
    message = (JSON.parse(body) as StreamChunk).error?.message ?? message;
  } catch {
    /* not JSON — the raw body is the best message we have */
  }

  // Overload and rate limits are transient; a 400 is our own bug and retrying it
  // just burns the user's quota to fail identically.
  if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
    await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    input.signal.throwIfAborted();
    return post(input, attempt + 1);
  }

  throw new GeminiError(`gemini ${res.status}: ${message}`, res.status);
}

/** One model turn, streamed. Returns once the model stops talking. */
export async function streamTurn(input: TurnInput): Promise<TurnResult> {
  // Aborted with a GeminiError rather than the usual DOMException on purpose:
  // `fetch` and `throwIfAborted` reject with the signal's REASON, and an
  // AbortError here would be read as "the user pressed Stop" and reported as a
  // cancelled job — the one outcome that says nothing went wrong.
  const stalled = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wind = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => stalled.abort(new GeminiError(`gemini sent nothing for ${STALL_MS / 1000}s`, 0)),
      STALL_MS,
    );
  };

  // The caller's signal still cancels; this one only adds a deadline to it.
  const signal = AbortSignal.any([input.signal, stalled.signal]);

  try {
    wind();
    const res = await post({ ...input, signal }, 1);
    if (!res.body) throw new GeminiError("gemini returned an empty body", res.status);

    const collected: Part[] = [];
    const usage: Usage = { promptTokenCount: 0, candidatesTokenCount: 0 };
    let finishReason: string | null = null;
    let text = "";

    for await (const chunk of streamJson<StreamChunk>(res.body, signal)) {
      // It is still talking, so the clock starts again.
      wind();
      const candidate = chunk.candidates?.[0];
      if (chunk.usageMetadata) {
        usage.promptTokenCount = chunk.usageMetadata.promptTokenCount ?? usage.promptTokenCount;
        usage.candidatesTokenCount =
          chunk.usageMetadata.candidatesTokenCount ?? usage.candidatesTokenCount;
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;

      for (const part of candidate?.content?.parts ?? []) {
        collected.push(part);
        // Publish the fragment before anything else touches it — this is the
        // token path, and everything downstream of it is allowed to be slower.
        if (part.text && !part.thought) {
          text += part.text;
          await input.onText(part.text);
        }
      }
    }

    const parts = mergeParts(collected);
    return {
      parts,
      calls: parts.flatMap((p) => (p.functionCall ? [p.functionCall] : [])),
      text,
      usage,
      finishReason,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
