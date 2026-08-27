/**
 * The agent loop (§6). Phase 2 shipped this file as a scripted stand-in; the
 * signature below is unchanged, which is the whole reason that swap touched
 * nothing else in the system.
 *
 * The contract: `run` emits events as it goes and returns what the job needs to
 * finish — the assistant's final text (persisted as a `messages` row) and how
 * many files it touched (shown on the ChangeCard).
 */
import type { Job, JobEventData } from "@/lib/types";
import * as typecheck from "@/server/infra/typecheck";
import { buildInitialContents, systemPrompt } from "./agent.prompt";
import * as tools from "./agent.tools";
import { type Content, type Part, streamTurn } from "./gemini.client";

export interface AgentContext {
  job: Job;
  emit: (data: JobEventData) => Promise<void>;
  signal: AbortSignal;
}

export interface AgentResult {
  text: string;
  filesChanged: number;
}

export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

/**
 * Two ceilings, because they bound different runaways (§7).
 *
 * Steps bound a model stuck in a read/edit/read cycle. Tokens bound the other
 * failure: context grows with every turn, so a job that makes progress slowly
 * can be cheap per step and ruinous in total — §14 risk 8 measured a one-line
 * edit at 34.3k prompt tokens before the pinned-source instruction landed. The
 * token ceiling is checked BEFORE each request, so the loop never spends money
 * on a turn it has already decided it cannot afford.
 */
const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS) || 12;
const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS) || 250_000;

/**
 * How many times a failing type check may hand the job back to the model.
 *
 * Small on purpose. A model that cannot fix its own compile error in two goes
 * is usually making it worse, and every round pays for the whole context again.
 */
const MAX_REPAIRS = Number(process.env.AGENT_MAX_REPAIRS) || 2;

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Cancelled();
}

/** `fetch` rejects with a DOMException on abort; everywhere else wants our type. */
function normalize(err: unknown, signal: AbortSignal): unknown {
  if (signal.aborted) return new Cancelled();
  if (err instanceof Error && err.name === "AbortError") return new Cancelled();
  return err;
}

export async function run(ctx: AgentContext): Promise<AgentResult> {
  const contents: Content[] = await buildInitialContents(ctx.job);
  const system = systemPrompt();
  const changed = new Set<string>();
  const usage = { promptTokenCount: 0, candidatesTokenCount: 0 };

  tools.resetRevisionSeq(ctx.job.id);

  let text = "";
  let stop: "steps" | "tokens" | "done" = "steps";
  let finishReason: string | null = null;

  let repairs = 0;
  let checks = 0;
  /**
   * Has anything been written since the last passing type check?
   *
   * Cleared by ANY passing check, including one the model asked for itself —
   * and it does, often. Without this the gate re-runs the compiler two seconds
   * after the model just ran it, on a workspace nothing has touched in between.
   */
  let dirty = false;
  /** Errors the last gate found and could not get fixed. Drives the warning. */
  let broken: typecheck.Diagnostic[] = [];

  /** Text goes to the client first and is accumulated second — same bytes, both ways. */
  async function say(fragment: string): Promise<void> {
    text += fragment;
    await ctx.emit({ type: "text_delta", text: fragment });
  }

  const spent = () => usage.promptTokenCount + usage.candidatesTokenCount;

  /**
   * The gate (§7). Runs when the model believes it is finished and something
   * has been written since the workspace was last known to compile. A job that
   * changed nothing cannot have broken anything, and checking anyway would hand
   * the model somebody else's errors to fix.
   *
   * Returns true when the job should keep going.
   */
  async function gate(): Promise<boolean> {
    if (!dirty) return false;

    const id = `typecheck-${checks++}`;
    await ctx.emit({ type: "tool_call", id, name: "typecheck", args: {} });
    const result = await typecheck.run(ctx.signal);
    throwIfCancelled(ctx.signal);

    // A checker that could not run is our problem, not the model's. Failing the
    // job over it would make a toolchain hiccup look like a broken edit.
    if (result.diagnostics === null) {
      console.error(`[agent] typecheck could not run for job ${ctx.job.id}: ${result.error}`);
      await ctx.emit({
        type: "tool_result",
        id,
        name: "typecheck",
        ok: false,
        summary: "type check could not run",
      });
      return false;
    }

    broken = result.diagnostics;
    if (broken.length === 0) dirty = false;
    await ctx.emit({
      type: "tool_result",
      id,
      name: "typecheck",
      ok: broken.length === 0,
      summary:
        broken.length === 0
          ? "type check passed"
          : `${broken.length} type error${broken.length === 1 ? "" : "s"}`,
    });

    if (broken.length === 0 || repairs >= MAX_REPAIRS) return false;
    repairs++;

    contents.push({
      role: "user",
      parts: [
        {
          text: `Your change does not type-check. These errors are in the workspace right now:\n\n${typecheck.format(
            broken,
          )}\n\nFix them. Read each file before editing it, and change only what is needed to clear the error — do not revert the work you just did unless the error says the approach itself is wrong.`,
        },
      ],
    });
    return true;
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    throwIfCancelled(ctx.signal);

    if (spent() >= MAX_TOKENS) {
      stop = "tokens";
      break;
    }

    let turnHasText = false;
    let turn;
    try {
      turn = await streamTurn({
        contents,
        system,
        tools: tools.declarations,
        signal: ctx.signal,
        onText: async (fragment) => {
          // A blank line between turns, emitted as a delta rather than added at
          // the end — otherwise the live stream and the persisted message would
          // disagree by exactly two characters.
          if (!turnHasText) {
            turnHasText = true;
            if (text.length > 0) await say("\n\n");
          }
          await say(fragment);
        },
      });
    } catch (err) {
      throw normalize(err, ctx.signal);
    }

    finishReason = turn.finishReason;
    usage.promptTokenCount += turn.usage.promptTokenCount;
    usage.candidatesTokenCount += turn.usage.candidatesTokenCount;

    // An empty parts array is not a legal turn to echo back, and a model that
    // said nothing and called nothing is done talking. The gate is skipped here
    // on purpose: with nothing to push, the repair instruction would follow the
    // previous user turn directly, and two user turns in a row is not a shape
    // worth risking for a degenerate case.
    if (turn.parts.length === 0) {
      stop = "done";
      break;
    }
    contents.push({ role: "model", parts: turn.parts });

    if (turn.calls.length === 0) {
      // ◀ the only exit condition — NOT finishReason, which is "STOP" here too.
      // A repair round consumes a step, because it is real model work.
      if (await gate()) continue;
      stop = "done";
      break;
    }

    const responses: Part[] = [];
    for (const [index, call] of turn.calls.entries()) {
      throwIfCancelled(ctx.signal);

      // The API supplies an id; synthesise one when it does not, because the
      // client keys ToolCards on it and two cards must never collide.
      const id = call.id ?? `${call.name}-${step}-${index}`;
      await ctx.emit({ type: "tool_call", id, name: call.name, args: call.args ?? {} });

      const outcome = await tools.execute(call, { jobId: ctx.job.id, signal: ctx.signal });

      await ctx.emit({ type: "tool_result", id, name: call.name, ok: outcome.ok, summary: outcome.summary });
      // A list, not one: `add_section` writes three files in a single call and
      // each of them is its own line on the ChangeCard.
      for (const change of outcome.changes ?? []) {
        changed.add(change.path);
        dirty = true;
        await ctx.emit(change);
      }
      // The model checking its own work counts. It is the same compiler over
      // the same files; running it again would buy nothing but two seconds.
      if (call.name === "typecheck" && outcome.ok) dirty = false;

      responses.push({ functionResponse: { name: call.name, id: call.id, response: outcome.payload } });
    }

    // ALL results in ONE user turn — splitting them teaches the model to stop
    // batching its calls.
    contents.push({ role: "user", parts: responses });
  }

  const gap = () => (text.length > 0 ? "\n\n" : "");

  if (stop === "steps") {
    await say(
      `${gap()}I stopped after ${MAX_STEPS} steps without finishing. Anything I already changed is in the diff — tell me how you'd like to continue.`,
    );
  } else if (stop === "tokens") {
    await say(
      `${gap()}I stopped after about ${Math.round(spent() / 1000)}k tokens without finishing, to keep this turn from getting expensive. Anything I already changed is in the diff — ask again with a narrower request, or pin the section you want changed.`,
    );
  } else if (text.trim().length === 0) {
    // A model turn with tool calls and no prose is normal mid-loop, but ending
    // that way leaves an empty bubble in the transcript and no explanation. Say
    // what happened instead — including `finishReason` when it is not "STOP",
    // which is how SAFETY, RECITATION and MAX_TOKENS reach the user at all.
    const why = finishReason && finishReason !== "STOP" ? ` (${finishReason})` : "";
    await say(
      changed.size > 0
        ? `Made the change without commentary${why} — the diff has the details.`
        : `The model finished without making a change or saying why${why}. Try rephrasing the request.`,
    );
  }

  // Said last, and said whatever else happened. A job that ends "done" while
  // the page no longer compiles is the exact failure this gate exists to catch,
  // and staying quiet about it would be worse than not having the gate at all.
  if (broken.length > 0) {
    const first = broken[0];
    await say(
      `${gap()}Heads up: the workspace still has ${broken.length} type error${
        broken.length === 1 ? "" : "s"
      } after ${repairs === 0 ? "this change" : `${repairs} attempt${repairs === 1 ? "" : "s"} to fix them`} — the first is in ${first.path} at line ${first.line}. The preview may not render. Undo this turn, or tell me what to try instead.`,
    );
  }

  await ctx.emit({ type: "usage", ...usage });
  return { text, filesChanged: changed.size };
}
