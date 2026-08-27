/**
 * The Phase 2 stand-in for the Gemini loop.
 *
 * It exists so the entire streaming spine — seq allocation, persist-before-
 * fanout, coalescing, SSE replay, the client reducer, ToolCards — can be driven
 * end to end and hammered in tests without spending a single token, which is
 * exactly what §15 asks Phase 2 to prove. It emits every variant of the event
 * union in a realistic order and at realistic pacing.
 *
 * It writes nothing to disk. `file_changed` here is theatre; Phase 3 swaps
 * `agent.service.run` for the real loop and the events become true.
 */
import type { Job, JobEventData } from "@/lib/types";
import { sections } from "@/workspace/manifest";

export interface ScriptedStep {
  /** Milliseconds to wait BEFORE emitting. */
  after: number;
  data: JobEventData;
}

// The real loop owns this type now; the fixture borrows it so a test that asserts
// on cancellation is asserting on the same class production throws.
import { Cancelled } from "./agent.service";
export { Cancelled };

function words(text: string): string[] {
  // Keep the trailing space on each chunk so concatenating deltas rebuilds the
  // string exactly — the client appends blindly and must not invent spacing.
  return text.split(/(?<= )/);
}

/** The reply the fake agent "writes", derived from the prompt so it reads real. */
function replyFor(job: Job): string {
  const attached = job.context?.attachments ?? [];
  const target = attached[0]?.label ?? sections[0]?.label ?? "the page";
  return (
    `Looking at ${target} now. ` +
    `I read the current source, applied the change you asked for — "${job.prompt.trim()}" — ` +
    `and left the surrounding markup alone. The preview should have repainted already.`
  );
}

export function script(job: Job): ScriptedStep[] {
  const attached = job.context?.attachments ?? [];
  const target = attached[0] ?? {
    sectionSlug: sections[0]?.slug ?? "hero",
    label: sections[0]?.label ?? "Hero",
    file: sections[0]?.file ?? "sections/hero.tsx",
  };

  const [opening, closing] = ((full: string) => {
    const parts = full.split(" — ");
    return [parts[0] + " ", parts.slice(1).join(" — ")];
  })(replyFor(job));

  const steps: ScriptedStep[] = [];
  const say = (text: string, gap = 24) => {
    for (const word of words(text)) steps.push({ after: gap, data: { type: "text_delta", text: word } });
  };

  say(opening);

  steps.push({
    after: 120,
    data: { type: "tool_call", id: "call_1", name: "read_file", args: { path: target.file } },
  });
  steps.push({
    after: 260,
    data: { type: "tool_result", id: "call_1", name: "read_file", ok: true, summary: "read 444 lines" },
  });

  say("Applying the edit. ");

  steps.push({
    after: 120,
    data: {
      type: "tool_call",
      id: "call_2",
      name: "edit_file",
      args: { path: target.file, find: "text-5xl", replace: "text-4xl" },
    },
  });
  steps.push({
    after: 380,
    data: { type: "tool_result", id: "call_2", name: "edit_file", ok: true, summary: "1 hunk" },
  });
  steps.push({
    after: 40,
    data: { type: "file_changed", path: target.file, op: "update", sectionSlug: target.sectionSlug },
  });

  say(closing);

  steps.push({
    after: 60,
    data: { type: "usage", promptTokenCount: 1_284, candidatesTokenCount: 96 },
  });

  return steps;
}

/** Resolves after `ms`, or rejects with `Cancelled` the moment the signal aborts. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Cancelled());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Cancelled());
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
