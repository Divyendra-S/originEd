/**
 * The scripted agent is the instrument Phase 2 is measured with — if it lies,
 * every conclusion drawn about the streaming spine is worthless.
 */
import { describe, expect, it } from "vitest";
import type { Job, JobEventData } from "@/lib/types";
import { Cancelled, script, wait } from "./agent.script";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    chatId: "chat-1",
    status: "queued",
    prompt: "make the headline smaller",
    context: null,
    error: null,
    createdAt: new Date(0).toISOString(),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

const typesOf = (steps: { data: JobEventData }[]) => steps.map((s) => s.data.type);

describe("agent.script", () => {
  it("emits a realistic sequence: text, tool call/result pairs, file_changed, usage", () => {
    const types = new Set(typesOf(script(job())));
    expect(types).toEqual(new Set(["text_delta", "tool_call", "tool_result", "file_changed", "usage"]));
  });

  it("never emits status or done — those belong to the job lifecycle, not the agent", () => {
    const types = typesOf(script(job()));
    expect(types).not.toContain("status");
    expect(types).not.toContain("done");
  });

  it("pairs every tool_result with a preceding tool_call of the same id", () => {
    const steps = script(job());
    const open = new Set<string>();
    for (const step of steps) {
      if (step.data.type === "tool_call") open.add(step.data.id);
      if (step.data.type === "tool_result") {
        expect(open.has(step.data.id)).toBe(true);
        open.delete(step.data.id);
      }
    }
    expect(open.size).toBe(0);
  });

  it("concatenated text_deltas rebuild the reply exactly, spacing included", () => {
    const text = script(job())
      .filter((s) => s.data.type === "text_delta")
      .map((s) => (s.data as Extract<JobEventData, { type: "text_delta" }>).text)
      .join("");

    expect(text).toContain("make the headline smaller");
    expect(text).not.toContain("  ");
    expect(text.split(" ").filter((w) => w.length === 0)).toHaveLength(0);
  });

  it("targets the attached section when the user pinned one", () => {
    const steps = script(
      job({
        context: {
          attachments: [
            {
              sectionSlug: "pricing",
              label: "Pricing",
              file: "sections/pricing.tsx",
              source: "<div/>",
              comments: [],
            },
          ],
        },
      }),
    );

    const changed = steps.find((s) => s.data.type === "file_changed");
    expect(changed?.data).toMatchObject({ path: "sections/pricing.tsx", sectionSlug: "pricing" });
  });

  it("falls back to the first manifest section with no attachment", () => {
    const changed = script(job()).find((s) => s.data.type === "file_changed");
    expect(changed?.data).toMatchObject({ sectionSlug: "hero" });
  });

  it("paces itself — every step has a non-negative delay", () => {
    expect(script(job()).every((s) => s.after >= 0)).toBe(true);
  });
});

describe("wait", () => {
  it("resolves after the delay", async () => {
    const started = process.hrtime.bigint();
    await wait(20, new AbortController().signal);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs).toBeGreaterThanOrEqual(15);
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(wait(10_000, controller.signal)).rejects.toBeInstanceOf(Cancelled);
  });

  it("rejects as soon as the signal aborts mid-wait", async () => {
    const controller = new AbortController();
    const pending = wait(10_000, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toBeInstanceOf(Cancelled);
  });

  it("does not leave the abort listener attached after resolving", async () => {
    const controller = new AbortController();
    await wait(1, controller.signal);
    // Aborting after a clean resolve must not throw an unhandled rejection.
    expect(() => controller.abort()).not.toThrow();
  });
});
