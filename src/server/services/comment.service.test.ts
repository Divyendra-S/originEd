/**
 * Notes on sections (§11).
 *
 * The one that matters is `resolveForJob`. A note is closed by the turn that
 * answers it, and the ids come out of the job's FROZEN context rather than from
 * a fresh query — so a note written while the agent was working survives to the
 * next turn instead of being ticked off by a job that never saw it. Resolving
 * "everything open on the sections this job touched" would look identical in
 * the happy case and eat that note in the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/workspace/manifest", () => ({
  sections: [
    { slug: "hero", label: "Hero", file: "sections/hero.tsx" },
    { slug: "features", label: "Features", file: "sections/features.tsx" },
  ],
}));

const notes = vi.hoisted(() => ({ open: [] as Comment[] }));
vi.mock("@/server/repositories/comment.repo", () => ({
  listOpen: vi.fn(async () => notes.open),
  create: vi.fn(async (input: { sectionSlug: string; body: string }) => ({
    ...comment(input.sectionSlug, input.body),
    id: "new",
  })),
  resolve: vi.fn(async () => {}),
  resolveManyForJob: vi.fn(async () => {}),
}));

import type { AttachedSection, Comment, Job } from "@/lib/types";
import * as commentRepo from "@/server/repositories/comment.repo";
import { MAX_BODY, add, list, resolve, resolveForJob } from "./comment.service";

function comment(sectionSlug: string, body: string, id = `c-${body}`): Comment {
  return {
    id,
    sectionSlug,
    body,
    status: "open",
    jobId: null,
    createdAt: "2026-01-01T00:00:00Z",
    resolvedAt: null,
    targetKey: null,
    targetRef: null,
    targetLabel: null,
  };
}

const attached = (sectionSlug: string, comments: AttachedSection["comments"]): AttachedSection => ({
  sectionSlug,
  label: sectionSlug,
  file: `sections/${sectionSlug}.tsx`,
  source: "// source",
  comments,
});

const context = (attachments: AttachedSection[]): Job["context"] => ({ attachments });

/** What the studio sends for an element. No `attrs` — it is preview-side only. */
const headlineRef = {
  sectionSlug: "hero",
  path: [0, 1],
  tag: "h1",
  text: "Stay ahead",
  nth: 0,
  trail: "section > div > h1",
  label: "Headline",
};

beforeEach(() => {
  notes.open = [];
  vi.clearAllMocks();
});

describe("list", () => {
  it("returns the open notes", async () => {
    notes.open = [comment("hero", "too big"), comment("features", "two columns")];
    expect((await list()).map((c) => c.body)).toEqual(["too big", "two columns"]);
  });

  it("drops a note on a section the agent has since deleted", async () => {
    // Same rule `snapshot` follows for a stale pin. The row stays in the table;
    // there is just nothing left on the page to anchor it to.
    notes.open = [comment("pricing", "orphaned"), comment("hero", "too big")];
    expect((await list()).map((c) => c.body)).toEqual(["too big"]);
  });
});

describe("add", () => {
  it("writes a note on a real section", async () => {
    await add({ sectionSlug: "hero", body: "too big" });
    expect(commentRepo.create).toHaveBeenCalledWith({ sectionSlug: "hero", body: "too big" });
  });

  it("returns null for a section that does not exist, rather than throwing", async () => {
    // The route turns this into a 404. A slug the client made up is the
    // caller's mistake, not a server fault.
    expect(await add({ sectionSlug: "pricing", body: "hi" })).toBeNull();
    expect(commentRepo.create).not.toHaveBeenCalled();
  });

  it("trims the body", async () => {
    await add({ sectionSlug: "hero", body: "  too big \n" });
    expect(commentRepo.create).toHaveBeenCalledWith({ sectionSlug: "hero", body: "too big" });
  });

  it("refuses a body that is only whitespace", async () => {
    await expect(add({ sectionSlug: "hero", body: "   " })).rejects.toThrow("empty");
  });

  it("caps the body rather than letting a note become a message", async () => {
    await add({ sectionSlug: "hero", body: "x".repeat(MAX_BODY + 50) });
    const written = vi.mocked(commentRepo.create).mock.calls[0][0].body;
    expect(written).toHaveLength(MAX_BODY);
  });

  it("carries the element through when the note is on one", async () => {
    const target = { key: "hero#0-1", label: "Headline", ref: headlineRef };
    await add({ sectionSlug: "hero", body: "too big", target });
    expect(commentRepo.create).toHaveBeenCalledWith({
      sectionSlug: "hero",
      body: "too big",
      target,
    });
  });

  it("drops a target whose path is empty — that IS the whole section", async () => {
    // `refKey` of a whole-section ref is the bare slug, so storing it as a
    // target would break the one invariant the column rests on (`target_key IS
    // NULL` ⇔ a section note) and put a redundant "on Hero:" in front of a note
    // that is already filed under Hero.
    await add({
      sectionSlug: "hero",
      body: "too tall",
      target: { key: "hero", label: "Hero", ref: { ...headlineRef, path: [], tag: "", text: "" } },
    });
    expect(commentRepo.create).toHaveBeenCalledWith({ sectionSlug: "hero", body: "too tall" });
  });
});

describe("resolve", () => {
  it("closes one note without crediting a job", async () => {
    await resolve("note-1");
    expect(commentRepo.resolve).toHaveBeenCalledWith("note-1");
  });
});

describe("resolveForJob", () => {
  it("closes exactly the notes frozen in the job's context", async () => {
    const ctx = context([
      attached("hero", [{ id: "n1", body: "too big", status: "open" }]),
      attached("features", [{ id: "n2", body: "two columns", status: "open" }]),
    ]);
    await resolveForJob("job-1", ctx);
    expect(commentRepo.resolveManyForJob).toHaveBeenCalledWith(["n1", "n2"], "job-1");
  });

  it("does NOT go looking for what is open now", async () => {
    // The note written while the agent was working is still open and must stay
    // that way — the job never saw it.
    notes.open = [comment("hero", "written mid-job", "n-late")];
    await resolveForJob("job-1", context([attached("hero", [{ id: "n1", body: "a", status: "open" }])]));
    expect(commentRepo.resolveManyForJob).toHaveBeenCalledWith(["n1"], "job-1");
    expect(commentRepo.listOpen).not.toHaveBeenCalled();
  });

  it("is a no-op for a job that carried no notes", async () => {
    expect(await resolveForJob("job-1", context([attached("hero", [])]))).toBe(0);
  });

  it("survives a job with no context at all", async () => {
    // Every job row written before this phase looks like this.
    expect(await resolveForJob("job-1", null)).toBe(0);
  });

  it("survives an attachment written before notes existed", async () => {
    const legacy = { ...attached("hero", []) } as AttachedSection;
    delete (legacy as Partial<AttachedSection>).comments;
    expect(await resolveForJob("job-1", context([legacy]))).toBe(0);
  });
});
