/**
 * §5's ordering guarantee, which is the whole contract behind the headline
 * feature (§11): the pinned source is snapshotted and frozen into the job
 * BEFORE the agent is queued.
 *
 * If it were read later — when the loop gets around to it — a fast second edit,
 * a hot reload, or a still-running previous job could change the file underneath
 * the user, and "the section you clicked" would silently become "the section as
 * it was some time afterwards". Everything else in this file is scaffolding for
 * that one assertion.
 */
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SANDBOX = ".chattest";

vi.mock("@/workspace/manifest", () => ({
  sections: [{ slug: "hero", label: "Hero", file: ".chattest/hero.tsx" }],
}));

vi.mock("@/server/repositories/chat.repo", () => ({
  byId: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/server/repositories/message.repo", () => ({
  insert: vi.fn(),
  listByChat: vi.fn(async () => []),
}));
vi.mock("@/server/repositories/job.repo", () => ({ insert: vi.fn() }));
// Real `section.service`, mocked repository: the point of this file is what the
// service does with what it reads, notes included.
const notes = vi.hoisted(() => ({ open: [] as Comment[] }));
vi.mock("@/server/repositories/comment.repo", () => ({
  listOpen: vi.fn(async () => notes.open),
}));
vi.mock("./job.service", () => ({ start: vi.fn() }));
vi.mock("./diff.service", () => ({ summarize: vi.fn(async () => []) }));

import type { Chat, Comment, Job, Message } from "@/lib/types";
import { WORKSPACE_ROOT } from "@/server/infra/workspace.fs";
import * as chatRepo from "@/server/repositories/chat.repo";
import * as jobRepo from "@/server/repositories/job.repo";
import * as messageRepo from "@/server/repositories/message.repo";
import * as jobService from "./job.service";
import { send, transcript } from "./chat.service";

const HERO = path.join(WORKSPACE_ROOT, SANDBOX, "hero.tsx");
const SOURCE = "export default function Hero() {\n  return <h1>Original</h1>;\n}\n";

const chat: Chat = { id: "chat-1", title: "t", createdAt: "2026-01-01T00:00:00Z" };
const job = { id: "job-1" } as Job;
const message = { id: "msg-1" } as Message;

/** Every mocked write appends here, so the ORDER of the four writes is testable. */
let calls: string[] = [];

const note = (body: string, id = `c-${body}`): Comment => ({
  id,
  sectionSlug: "hero",
  body,
  status: "open",
  jobId: null,
  createdAt: "2026-01-01T00:00:00Z",
  resolvedAt: null,
  targetKey: null,
  targetRef: null,
  targetLabel: null,
});

beforeEach(async () => {
  calls = [];
  notes.open = [];
  await nodeFs.mkdir(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true });
  await nodeFs.writeFile(HERO, SOURCE, "utf8");

  vi.mocked(chatRepo.byId).mockReset().mockResolvedValue(chat);
  vi.mocked(chatRepo.create).mockReset().mockResolvedValue(chat);
  vi.mocked(jobRepo.insert)
    .mockReset()
    .mockImplementation(async () => {
      calls.push("job.insert");
      return job;
    });
  vi.mocked(messageRepo.insert)
    .mockReset()
    .mockImplementation(async () => {
      calls.push("message.insert");
      return message;
    });
  vi.mocked(jobService.start)
    .mockReset()
    .mockImplementation(() => {
      calls.push("job.start");
    });
});

afterEach(async () => {
  await nodeFs.rm(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true, force: true });
});

const contextOf = () => vi.mocked(jobRepo.insert).mock.calls[0][0].context!;

describe("send — the frozen context", () => {
  it("writes the pinned source into the job VERBATIM", async () => {
    await send({ chatId: "chat-1", text: "smaller headline", attachments: ["hero"] });
    expect(contextOf().attachments[0].source).toBe(SOURCE);
  });

  it("freezes the bytes BEFORE queueing the agent, not when the loop reads them", async () => {
    // The agent's own tools re-read the file; the pin does not. Prove the two
    // are different by changing the file the instant the job is queued: the
    // snapshot already in `jobs.context` must not follow it.
    vi.mocked(jobService.start).mockImplementation(() => {
      calls.push("job.start");
      void nodeFs.writeFile(HERO, "// clobbered\n", "utf8");
    });

    await send({ chatId: "chat-1", text: "smaller headline", attachments: ["hero"] });
    expect(contextOf().attachments[0].source).toBe(SOURCE);
  });

  it("freezes the NOTES at the same moment, so a late one belongs to the next turn", async () => {
    notes.open = [note("headline is too big")];
    // A note written while the job is being queued is not part of this turn.
    // It matters because the job resolves the notes in its context on success:
    // one that slipped in late would be closed without ever having been read.
    vi.mocked(jobService.start).mockImplementation(() => {
      calls.push("job.start");
      notes.open = [...notes.open, note("and the padding")];
    });

    await send({ chatId: "chat-1", text: "fix it", attachments: ["hero"] });
    expect(contextOf().attachments[0].comments.map((c) => c.body)).toEqual([
      "headline is too big",
    ]);
  });

  it("carries the notes' ids, which is what the job closes on success", async () => {
    notes.open = [note("too big", "note-1")];
    await send({ chatId: "chat-1", text: "fix it", attachments: ["hero"] });
    expect(contextOf().attachments[0].comments).toEqual([
      { id: "note-1", body: "too big", status: "open" },
    ]);
  });

  it("queues the agent only after the job row exists to stream into", async () => {
    await send({ chatId: "chat-1", text: "hi", attachments: [] });
    expect(calls).toEqual(["job.insert", "message.insert", "job.start"]);
  });

  it("puts the same attachments on the user's message, so the chips survive a reload", async () => {
    await send({ chatId: "chat-1", text: "hi", attachments: ["hero"] });
    const written = vi.mocked(messageRepo.insert).mock.calls[0][0];
    expect(written.content.attachments).toEqual(contextOf().attachments);
  });

  it("links the user turn to its job, so the transcript can hang tools off it", async () => {
    await send({ chatId: "chat-1", text: "hi", attachments: [] });
    expect(vi.mocked(messageRepo.insert).mock.calls[0][0].jobId).toBe("job-1");
  });

  it("sends an empty attachment list when nothing was pinned", async () => {
    await send({ chatId: "chat-1", text: "hi" });
    expect(contextOf().attachments).toEqual([]);
  });

  it("drops a pin whose section no longer exists rather than failing the send", async () => {
    await send({ chatId: "chat-1", text: "hi", attachments: ["pricing"] });
    expect(contextOf().attachments).toEqual([]);
    expect(vi.mocked(jobService.start)).toHaveBeenCalledOnce();
  });
});

describe("send — the chat row", () => {
  it("reuses an existing chat", async () => {
    await send({ chatId: "chat-1", text: "hi" });
    expect(vi.mocked(chatRepo.create)).not.toHaveBeenCalled();
  });

  it("creates one on the first message, titled from the text", async () => {
    await send({ text: "make the headline smaller" });
    expect(vi.mocked(chatRepo.create)).toHaveBeenCalledWith("make the headline smaller");
  });

  it("truncates a long first message into a title", async () => {
    await send({ text: "x".repeat(200) });
    const title = vi.mocked(chatRepo.create).mock.calls[0][0]!;
    expect(title).toHaveLength(58);
    expect(title.endsWith("…")).toBe(true);
  });

  it("refuses an empty message before touching Postgres", async () => {
    await expect(send({ text: "   " })).rejects.toThrow(/empty/);
    expect(vi.mocked(chatRepo.create)).not.toHaveBeenCalled();
  });

  it("refuses a chatId that does not resolve", async () => {
    vi.mocked(chatRepo.byId).mockResolvedValue(null);
    await expect(send({ chatId: "gone", text: "hi" })).rejects.toThrow(/not found/);
  });
});

describe("transcript", () => {
  it("is null for a chat that does not exist", async () => {
    vi.mocked(chatRepo.byId).mockResolvedValue(null);
    expect(await transcript("gone")).toBeNull();
  });

  it("asks for change summaries once, for the distinct jobs in the chat", async () => {
    const diffService = await import("./diff.service");
    vi.mocked(messageRepo.listByChat).mockResolvedValue([
      { id: "m1", jobId: "job-1", role: "user" } as Message,
      { id: "m2", jobId: "job-1", role: "model" } as Message,
      { id: "m3", jobId: null, role: "model" } as Message,
      { id: "m4", jobId: "job-2", role: "user" } as Message,
    ]);
    await transcript("chat-1");
    expect(vi.mocked(diffService.summarize)).toHaveBeenCalledWith(["job-1", "job-2"]);
  });
});
