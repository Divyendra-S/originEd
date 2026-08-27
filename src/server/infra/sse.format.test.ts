import { describe, expect, it } from "vitest";
import type { JobEvent } from "@/lib/types";
import { COMMENT_OPEN, COMMENT_PING, frame, frameless, retry } from "./sse.format";

/** Splits a wire string into complete frames the way an SSE client does. */
function parseFrames(wire: string) {
  return wire
    .split("\n\n")
    .filter((block) => block.trim().length > 0 && !block.startsWith(":"))
    .map((block) => {
      const out: { id?: string; event?: string; data: string } = { data: "" };
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("id: ")) out.id = line.slice(4);
        else if (line.startsWith("event: ")) out.event = line.slice(7);
        else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
      }
      out.data = dataLines.join("\n");
      return out;
    });
}

describe("sse.format", () => {
  it("emits id, event name and data, terminated by a blank line", () => {
    const event: JobEvent = { seq: 7, jobId: "job-1", type: "status", status: "running" };
    const wire = frame(event);

    expect(wire).toBe('id: 7\nevent: status\ndata: {"type":"status","status":"running"}\n\n');
    expect(wire.endsWith("\n\n")).toBe(true);
  });

  it("does not put the jobId on the wire", () => {
    const wire = frame({ seq: 1, jobId: "job-secret", type: "text_delta", text: "hi" });
    expect(wire).not.toContain("job-secret");
    expect(wire).not.toContain("jobId");
  });

  it("keeps the type inside data so one client parser handles every variant", () => {
    const [parsed] = parseFrames(frame({ seq: 3, jobId: "j", type: "text_delta", text: "hi" }));
    expect(parsed.event).toBe("text_delta");
    expect(JSON.parse(parsed.data)).toEqual({ type: "text_delta", text: "hi" });
  });

  it("survives a payload containing newlines", () => {
    const wire = frame({ seq: 2, jobId: "j", type: "text_delta", text: "line one\nline two" });
    const [parsed] = parseFrames(wire);
    expect(JSON.parse(parsed.data).text).toBe("line one\nline two");
    // Exactly one frame — the newline must not have split it.
    expect(parseFrames(wire)).toHaveLength(1);
  });

  it("round-trips every event variant", () => {
    const events: JobEvent[] = [
      { seq: 1, jobId: "j", type: "status", status: "running" },
      { seq: 2, jobId: "j", type: "text_delta", text: "Looking " },
      { seq: 3, jobId: "j", type: "tool_call", id: "c1", name: "edit_file", args: { path: "a.tsx" } },
      { seq: 4, jobId: "j", type: "tool_result", id: "c1", name: "edit_file", ok: true, summary: "1 hunk" },
      { seq: 5, jobId: "j", type: "file_changed", path: "a.tsx", op: "update", sectionSlug: "hero" },
      { seq: 6, jobId: "j", type: "usage", promptTokenCount: 10, candidatesTokenCount: 2 },
      { seq: 7, jobId: "j", type: "error", message: "boom" },
      { seq: 8, jobId: "j", type: "done", status: "succeeded", filesChanged: 1 },
    ];

    const parsed = parseFrames(events.map(frame).join(""));
    expect(parsed).toHaveLength(8);
    parsed.forEach((entry, i) => {
      const { seq, jobId, ...data } = events[i];
      expect(entry.id).toBe(String(seq));
      expect(entry.event).toBe(data.type);
      expect(JSON.parse(entry.data)).toEqual(data);
      expect(jobId).toBe("j");
    });
  });

  it("frameless omits the id line so a synthetic event cannot move Last-Event-ID", () => {
    const wire = frameless({ type: "done", status: "failed", filesChanged: 0 });
    expect(wire).not.toContain("id:");
    expect(parseFrames(wire)[0].id).toBeUndefined();
  });

  it("comments and retry are well formed", () => {
    expect(COMMENT_PING).toBe(": ping\n\n");
    expect(COMMENT_OPEN).toBe(": open\n\n");
    expect(retry(3000)).toBe("retry: 3000\n\n");
    // A comment must parse as zero events, not as a malformed one.
    expect(parseFrames(COMMENT_PING)).toHaveLength(0);
  });
});
