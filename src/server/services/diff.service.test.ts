/**
 * The diff is derived, never stored — so these tests are mostly about `collapse`,
 * which is where the derivation can quietly go wrong. The properties that matter:
 *
 *  1. Four edits to one file are ONE entry, first `before` → last `after`.
 *  2. A job whose net effect was nothing shows nothing.
 *  3. Restore walks backwards and lands on the exact original bytes.
 *  4. Restore REFUSES when a later turn still stands on the same file — undoing
 *     it would overwrite work with no way back.
 */
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/revision.repo", () => ({
  listByJob: vi.fn(async () => []),
  summaryByJobs: vi.fn(async () => []),
  laterActive: vi.fn(async () => []),
  markReverted: vi.fn(async () => {}),
}));

import type { FileRevision } from "@/lib/types";
import { WORKSPACE_ROOT } from "@/server/infra/workspace.fs";
import * as revisionRepo from "@/server/repositories/revision.repo";
import { collapse, forJob, restore, RestoreConflict, summarize } from "./diff.service";

const SANDBOX = ".difftest";
const rel = (p: string) => `${SANDBOX}/${p}`;
const abs = (p: string) => path.join(WORKSPACE_ROOT, SANDBOX, p);

/** A revision row with only the fields the code under test reads. */
let nextId = 1;
function rev(partial: Partial<FileRevision> & { seq: number; path: string }): FileRevision {
  return {
    id: partial.id ?? nextId++,
    jobId: partial.jobId ?? "job-1",
    op: partial.op ?? "update",
    before: partial.before ?? null,
    after: partial.after ?? null,
    revertedAt: partial.revertedAt ?? null,
    createdAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

const givenRevisions = (revs: FileRevision[]) =>
  vi.mocked(revisionRepo.listByJob).mockResolvedValue(revs);

beforeEach(async () => {
  nextId = 1;
  vi.mocked(revisionRepo.listByJob).mockReset().mockResolvedValue([]);
  vi.mocked(revisionRepo.laterActive).mockReset().mockResolvedValue([]);
  vi.mocked(revisionRepo.markReverted).mockReset().mockResolvedValue(undefined);
  vi.mocked(revisionRepo.summaryByJobs).mockReset().mockResolvedValue([]);
  await nodeFs.mkdir(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true });
});

afterEach(async () => {
  await nodeFs.rm(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true, force: true });
});

describe("collapse", () => {
  it("keeps a single edit as one entry", () => {
    const out = collapse([rev({ seq: 1, path: "a.tsx", before: "one", after: "two" })]);
    expect(out).toEqual([{ path: "a.tsx", op: "update", before: "one", after: "two" }]);
  });

  it("folds four edits to one file into first-before → last-after", () => {
    const out = collapse([
      rev({ seq: 1, path: "a.tsx", before: "v0", after: "v1" }),
      rev({ seq: 2, path: "a.tsx", before: "v1", after: "v2" }),
      rev({ seq: 3, path: "a.tsx", before: "v2", after: "v3" }),
      rev({ seq: 4, path: "a.tsx", before: "v3", after: "v4" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ before: "v0", after: "v4", op: "update" });
  });

  it("derives create for a file the job created and then edited", () => {
    const out = collapse([
      rev({ seq: 1, path: "a.tsx", op: "create", before: null, after: "v1" }),
      rev({ seq: 2, path: "a.tsx", op: "update", before: "v1", after: "v2" }),
    ]);
    expect(out[0]).toMatchObject({ op: "create", before: null, after: "v2" });
  });

  it("derives delete when the last write removed the file", () => {
    const out = collapse([
      rev({ seq: 1, path: "a.tsx", op: "update", before: "v0", after: "v1" }),
      rev({ seq: 2, path: "a.tsx", op: "delete", before: "v1", after: null }),
    ]);
    expect(out[0]).toMatchObject({ op: "delete", before: "v0", after: null });
  });

  it("derives update — not create — when a file was deleted then written back", () => {
    const out = collapse([
      rev({ seq: 1, path: "a.tsx", op: "delete", before: "v0", after: null }),
      rev({ seq: 2, path: "a.tsx", op: "create", before: null, after: "v1" }),
    ]);
    expect(out[0]).toMatchObject({ op: "update", before: "v0", after: "v1" });
  });

  it("drops a file created and deleted in the same job", () => {
    expect(
      collapse([
        rev({ seq: 1, path: "a.tsx", op: "create", before: null, after: "v1" }),
        rev({ seq: 2, path: "a.tsx", op: "delete", before: "v1", after: null }),
      ]),
    ).toEqual([]);
  });

  it("drops an edit the agent talked itself out of", () => {
    expect(
      collapse([
        rev({ seq: 1, path: "a.tsx", before: "v0", after: "v1" }),
        rev({ seq: 2, path: "a.tsx", before: "v1", after: "v0" }),
      ]),
    ).toEqual([]);
  });

  it("returns files in first-touched order, not alphabetical", () => {
    const out = collapse([
      rev({ seq: 1, path: "z.tsx", before: "a", after: "b" }),
      rev({ seq: 2, path: "a.tsx", before: "a", after: "b" }),
      rev({ seq: 3, path: "z.tsx", before: "b", after: "c" }),
    ]);
    expect(out.map((f) => f.path)).toEqual(["z.tsx", "a.tsx"]);
  });

  it("sorts by seq before folding, whatever order it is handed", () => {
    const out = collapse([
      rev({ seq: 3, path: "a.tsx", before: "v2", after: "v3" }),
      rev({ seq: 1, path: "a.tsx", before: "v0", after: "v1" }),
      rev({ seq: 2, path: "a.tsx", before: "v1", after: "v2" }),
    ]);
    expect(out[0]).toMatchObject({ before: "v0", after: "v3" });
  });
});

describe("forJob", () => {
  it("produces hunks and counts changed lines", async () => {
    givenRevisions([
      rev({ seq: 1, path: "a.tsx", before: "one\ntwo\nthree\n", after: "one\nTWO\nthree\nfour\n" }),
    ]);
    const diff = await forJob("job-1");

    expect(diff.files).toHaveLength(1);
    expect(diff.files[0].added).toBe(2); // TWO + four
    expect(diff.files[0].removed).toBe(1); // two
    expect(diff.files[0].hunks[0].lines).toContain("-two");
    expect(diff.files[0].hunks[0].lines).toContain("+TWO");
  });

  it("shows a created file as all additions", async () => {
    givenRevisions([
      rev({ seq: 1, path: "a.tsx", op: "create", before: null, after: "a\nb\nc\n" }),
    ]);
    const diff = await forJob("job-1");
    expect(diff.files[0]).toMatchObject({ op: "create", added: 3, removed: 0 });
  });

  it("shows a deleted file as all removals", async () => {
    givenRevisions([
      rev({ seq: 1, path: "a.tsx", op: "delete", before: "a\nb\n", after: null }),
    ]);
    const diff = await forJob("job-1");
    expect(diff.files[0]).toMatchObject({ op: "delete", added: 0, removed: 2 });
  });

  it("names the section, not the path", async () => {
    givenRevisions([
      rev({ seq: 1, path: "sections/hero.tsx", before: "a\n", after: "b\n" }),
    ]);
    const diff = await forJob("job-1");
    expect(diff.files[0]).toMatchObject({ sectionSlug: "hero", label: "Hero" });
  });

  it("leaves slug and label null for a file no section claims", async () => {
    givenRevisions([rev({ seq: 1, path: "lib/util.ts", before: "a\n", after: "b\n" })]);
    const diff = await forJob("job-1");
    expect(diff.files[0]).toMatchObject({ sectionSlug: null, label: null });
  });

  it("reports reverted only when every revision is undone", async () => {
    givenRevisions([
      rev({ seq: 1, path: "a.tsx", before: "a", after: "b", revertedAt: "2026-01-01T00:00:00Z" }),
      rev({ seq: 2, path: "b.tsx", before: "a", after: "b", revertedAt: null }),
    ]);
    expect((await forJob("job-1")).reverted).toBe(false);
  });

  it("is empty, not reverted, for a job that wrote nothing", async () => {
    givenRevisions([]);
    expect(await forJob("job-1")).toEqual({ jobId: "job-1", files: [], reverted: false });
  });
});

describe("summarize", () => {
  it("groups by job and dedupes repeated paths", async () => {
    vi.mocked(revisionRepo.summaryByJobs).mockResolvedValue([
      { jobId: "j1", seq: 1, path: "sections/hero.tsx", op: "update", revertedAt: null },
      { jobId: "j1", seq: 2, path: "sections/hero.tsx", op: "update", revertedAt: null },
      { jobId: "j2", seq: 1, path: "lib/util.ts", op: "create", revertedAt: null },
    ]);

    const out = await summarize(["j1", "j2"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ jobId: "j1", reverted: false });
    expect(out[0].files).toHaveLength(1);
    expect(out[0].files[0]).toMatchObject({ sectionSlug: "hero", label: "Hero" });
  });

  it("marks a job reverted only when all of its rows are", async () => {
    vi.mocked(revisionRepo.summaryByJobs).mockResolvedValue([
      { jobId: "j1", seq: 1, path: "a.tsx", op: "update", revertedAt: "2026-01-01T00:00:00Z" },
      { jobId: "j1", seq: 2, path: "b.tsx", op: "update", revertedAt: "2026-01-01T00:00:00Z" },
      { jobId: "j2", seq: 1, path: "c.tsx", op: "update", revertedAt: "2026-01-01T00:00:00Z" },
      { jobId: "j2", seq: 2, path: "d.tsx", op: "update", revertedAt: null },
    ]);

    const out = await summarize(["j1", "j2"]);
    expect(out.find((c) => c.jobId === "j1")?.reverted).toBe(true);
    expect(out.find((c) => c.jobId === "j2")?.reverted).toBe(false);
  });

  it("skips the query entirely for a chat with no jobs", async () => {
    await summarize([]);
    expect(revisionRepo.summaryByJobs).toHaveBeenCalledWith([]);
  });
});

describe("restore", () => {
  it("writes the original bytes back", async () => {
    await nodeFs.writeFile(abs("a.tsx"), "edited\n");
    givenRevisions([rev({ seq: 1, path: rel("a.tsx"), before: "original\n", after: "edited\n" })]);

    await restore("job-1");

    expect(await nodeFs.readFile(abs("a.tsx"), "utf8")).toBe("original\n");
    expect(revisionRepo.markReverted).toHaveBeenCalledWith("job-1");
  });

  it("walks backwards through every intermediate state", async () => {
    await nodeFs.writeFile(abs("a.tsx"), "v3\n");
    givenRevisions([
      rev({ seq: 1, path: rel("a.tsx"), before: "v0\n", after: "v1\n" }),
      rev({ seq: 2, path: rel("a.tsx"), before: "v1\n", after: "v2\n" }),
      rev({ seq: 3, path: rel("a.tsx"), before: "v2\n", after: "v3\n" }),
    ]);

    await restore("job-1");
    expect(await nodeFs.readFile(abs("a.tsx"), "utf8")).toBe("v0\n");
  });

  it("deletes a file the job created", async () => {
    await nodeFs.writeFile(abs("new.tsx"), "made up\n");
    givenRevisions([
      rev({ seq: 1, path: rel("new.tsx"), op: "create", before: null, after: "made up\n" }),
    ]);

    await restore("job-1");
    await expect(nodeFs.stat(abs("new.tsx"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("tolerates a created file that is already gone", async () => {
    givenRevisions([
      rev({ seq: 1, path: rel("ghost.tsx"), op: "create", before: null, after: "x\n" }),
    ]);
    await expect(restore("job-1")).resolves.toBeDefined();
  });

  it("restores several files in one turn", async () => {
    await nodeFs.writeFile(abs("a.tsx"), "a-new\n");
    await nodeFs.writeFile(abs("b.tsx"), "b-new\n");
    givenRevisions([
      rev({ seq: 1, path: rel("a.tsx"), before: "a-old\n", after: "a-new\n" }),
      rev({ seq: 2, path: rel("b.tsx"), before: "b-old\n", after: "b-new\n" }),
    ]);

    await restore("job-1");
    expect(await nodeFs.readFile(abs("a.tsx"), "utf8")).toBe("a-old\n");
    expect(await nodeFs.readFile(abs("b.tsx"), "utf8")).toBe("b-old\n");
  });

  it("is idempotent — a second restore does not write again", async () => {
    await nodeFs.writeFile(abs("a.tsx"), "current\n");
    givenRevisions([
      rev({
        seq: 1,
        path: rel("a.tsx"),
        before: "original\n",
        after: "edited\n",
        revertedAt: "2026-01-01T00:00:00Z",
      }),
    ]);

    const out = await restore("job-1");
    expect(out.reverted).toBe(true);
    expect(await nodeFs.readFile(abs("a.tsx"), "utf8")).toBe("current\n"); // untouched
    expect(revisionRepo.markReverted).not.toHaveBeenCalled();
  });

  it("refuses when a later turn still stands on the same file", async () => {
    await nodeFs.writeFile(abs("a.tsx"), "newest\n");
    givenRevisions([
      rev({ id: 10, seq: 1, path: "sections/hero.tsx", before: "v0\n", after: "v1\n" }),
    ]);
    vi.mocked(revisionRepo.laterActive).mockResolvedValue([
      rev({ id: 11, jobId: "job-2", seq: 1, path: "sections/hero.tsx", before: "v1\n", after: "v2\n" }),
    ]);

    await expect(restore("job-1")).rejects.toBeInstanceOf(RestoreConflict);
    await expect(restore("job-1")).rejects.toThrow(/Hero/);
    expect(revisionRepo.markReverted).not.toHaveBeenCalled();
  });

  it("asks about newer revisions using the job's highest id", async () => {
    givenRevisions([
      rev({ id: 7, seq: 1, path: rel("a.tsx"), before: "x\n", after: "y\n" }),
      rev({ id: 9, seq: 2, path: rel("b.tsx"), before: "x\n", after: "y\n" }),
      rev({ id: 8, seq: 3, path: rel("a.tsx"), before: "y\n", after: "z\n" }),
    ]);
    await nodeFs.writeFile(abs("a.tsx"), "z\n");
    await nodeFs.writeFile(abs("b.tsx"), "y\n");

    await restore("job-1");
    expect(revisionRepo.laterActive).toHaveBeenCalledWith(9, [rel("a.tsx"), rel("b.tsx")]);
  });

  it("proceeds once the later turn has itself been restored", async () => {
    await nodeFs.writeFile(abs("a.tsx"), "v1\n");
    givenRevisions([rev({ seq: 1, path: rel("a.tsx"), before: "v0\n", after: "v1\n" })]);
    vi.mocked(revisionRepo.laterActive).mockResolvedValue([]); // reverted rows are excluded by the query

    await restore("job-1");
    expect(await nodeFs.readFile(abs("a.tsx"), "utf8")).toBe("v0\n");
  });

  it("refuses a job that never wrote anything", async () => {
    givenRevisions([]);
    await expect(restore("job-1")).rejects.toBeInstanceOf(RestoreConflict);
  });
});
