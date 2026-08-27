/**
 * The read half of the verbatim guarantee (§11).
 *
 * `agent.prompt.test.ts` proves the bytes survive being RENDERED for the model.
 * This proves they survive being READ — that what lands in `jobs.context` is the
 * file, not a normalised, re-indented, newline-tidied version of it. A verbatim
 * promise that quietly strips a trailing newline is worse than no promise: the
 * agent's `edit_file` matches on exact text, so the diff it computes against
 * mangled bytes will not apply.
 */
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SANDBOX = ".sectiontest";

vi.mock("@/workspace/manifest", () => ({
  sections: [
    { slug: "hero", label: "Hero", file: ".sectiontest/hero.tsx" },
    { slug: "features", label: "Features", file: ".sectiontest/features.tsx" },
    { slug: "ghost", label: "Ghost", file: ".sectiontest/ghost.tsx" },
  ],
}));

// Notes are frozen alongside the source (§11), so the read path now reaches
// Postgres. Mocked at the repository so the service under test stays real.
const notes = vi.hoisted(() => ({ open: [] as Comment[] }));
vi.mock("@/server/repositories/comment.repo", () => ({
  listOpen: vi.fn(async () => notes.open),
}));

import type { Comment } from "@/lib/types";
import { WORKSPACE_ROOT } from "@/server/infra/workspace.fs";
import * as commentRepo from "@/server/repositories/comment.repo";
import { bySlug, list, snapshot } from "./section.service";

const note = (sectionSlug: string, body: string, id = `c-${body}`): Comment => ({
  id,
  sectionSlug,
  body,
  status: "open",
  jobId: null,
  createdAt: "2026-01-01T00:00:00Z",
  resolvedAt: null,
});

const abs = (name: string) => path.join(WORKSPACE_ROOT, SANDBOX, name);
const write = (name: string, body: string) => nodeFs.writeFile(abs(name), body, "utf8");

beforeEach(async () => {
  notes.open = [];
  vi.mocked(commentRepo.listOpen).mockClear();
  await nodeFs.mkdir(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true });
  // "ghost" deliberately has no file: a section the agent deleted from disk.
  await write("hero.tsx", "export default function Hero() {}\n");
  await write("features.tsx", "export default function Features() {}\n");
});

afterEach(async () => {
  await nodeFs.rm(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true, force: true });
});

describe("list / bySlug", () => {
  it("reports the manifest, which is the only source of truth (§9)", () => {
    expect(list().map((s) => s.slug)).toEqual(["hero", "features", "ghost"]);
  });

  it("returns null for a slug that is not on the page", () => {
    expect(bySlug("pricing")).toBeNull();
  });
});

describe("snapshot — verbatim", () => {
  it("returns the file byte for byte", async () => {
    const source = "export default function Hero() {\n  return <div>hi</div>;\n}\n";
    await write("hero.tsx", source);
    const [attached] = await snapshot(["hero"]);
    expect(attached.source).toBe(source);
  });

  it("does not add a trailing newline to a file that has none", async () => {
    await write("hero.tsx", "const a = 1;");
    const [attached] = await snapshot(["hero"]);
    expect(attached.source).toBe("const a = 1;");
  });

  it("keeps a file's trailing blank lines", async () => {
    await write("hero.tsx", "const a = 1;\n\n\n");
    const [attached] = await snapshot(["hero"]);
    expect(attached.source).toBe("const a = 1;\n\n\n");
  });

  it("keeps CRLF line endings rather than normalising them", async () => {
    await write("hero.tsx", "const a = 1;\r\nconst b = 2;\r\n");
    const [attached] = await snapshot(["hero"]);
    expect(attached.source).toBe("const a = 1;\r\nconst b = 2;\r\n");
  });

  it("keeps tabs, trailing spaces and indentation exactly — edit_file matches on them", async () => {
    const source = "function f() {\n\tconst a = 1;   \n      return a;\n}\n";
    await write("hero.tsx", source);
    const [attached] = await snapshot(["hero"]);
    expect(attached.source).toBe(source);
  });

  it("survives content that looks like the delimiters it will be wrapped in", async () => {
    const source = 'const s = `</attached-section>`;\nconst t = "```tsx";\n';
    await write("hero.tsx", source);
    const [attached] = await snapshot(["hero"]);
    expect(attached.source).toBe(source);
  });

  it("keeps non-ASCII characters intact", async () => {
    const source = 'const label = "Café · 日本語 · 🎯";\n';
    await write("hero.tsx", source);
    const [attached] = await snapshot(["hero"]);
    expect(attached.source).toBe(source);
  });
});

describe("snapshot — which sections come back", () => {
  it("carries the slug, label and file from the manifest", async () => {
    const [attached] = await snapshot(["features"]);
    expect(attached).toMatchObject({
      sectionSlug: "features",
      label: "Features",
      file: ".sectiontest/features.tsx",
    });
  });

  it("returns pins in the order the user clicked them, not manifest order", async () => {
    const attached = await snapshot(["features", "hero"]);
    expect(attached.map((a) => a.sectionSlug)).toEqual(["features", "hero"]);
  });

  it("pins a section once even if the slug arrives twice", async () => {
    const attached = await snapshot(["hero", "hero"]);
    expect(attached).toHaveLength(1);
  });

  it("drops an unknown slug instead of throwing — a stale pin is not a 500", async () => {
    const attached = await snapshot(["pricing", "hero"]);
    expect(attached.map((a) => a.sectionSlug)).toEqual(["hero"]);
  });

  it("drops a section whose file the agent deleted", async () => {
    const attached = await snapshot(["ghost", "hero"]);
    expect(attached.map((a) => a.sectionSlug)).toEqual(["hero"]);
  });

  it("returns nothing when nothing is pinned", async () => {
    expect(await snapshot([])).toEqual([]);
  });

  it("carries no notes for a section that has none", async () => {
    const [attached] = await snapshot(["hero"]);
    expect(attached.comments).toEqual([]);
  });
});

/**
 * The other half of "frozen at send time". The source is snapshotted so the
 * agent edits the bytes the user was looking at; the notes are snapshotted for
 * the same reason and in the same breath — and they carry ids, because the job
 * closes exactly these on success rather than whatever is open when it lands.
 */
describe("snapshot — notes", () => {
  it("attaches a section's open notes to it", async () => {
    notes.open = [note("hero", "headline is too big")];
    const [attached] = await snapshot(["hero"]);
    expect(attached.comments).toEqual([
      { id: "c-headline is too big", body: "headline is too big", status: "open" },
    ]);
  });

  it("gives each section only its OWN notes", async () => {
    notes.open = [note("hero", "too big"), note("features", "should be 2 columns")];
    const [hero, features] = await snapshot(["hero", "features"]);
    expect(hero.comments.map((c) => c.body)).toEqual(["too big"]);
    expect(features.comments.map((c) => c.body)).toEqual(["should be 2 columns"]);
  });

  it("keeps several notes on one section, oldest first", async () => {
    notes.open = [note("hero", "first"), note("hero", "second"), note("hero", "third")];
    const [attached] = await snapshot(["hero"]);
    expect(attached.comments.map((c) => c.body)).toEqual(["first", "second", "third"]);
  });

  it("carries the id, which is how the job knows what to close", async () => {
    notes.open = [note("hero", "too big", "11111111-1111-1111-1111-111111111111")];
    const [attached] = await snapshot(["hero"]);
    expect(attached.comments[0].id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("ignores notes on a section that is not pinned", async () => {
    notes.open = [note("features", "should be 2 columns")];
    const [attached] = await snapshot(["hero"]);
    expect(attached.comments).toEqual([]);
  });

  it("does not go to the database when nothing is pinned", async () => {
    // The empty case is the common one — a message with no pins should not cost
    // a round trip to find out that it has no notes either.
    notes.open = [note("hero", "too big")];
    expect(await snapshot([])).toEqual([]);
    expect(commentRepo.listOpen).not.toHaveBeenCalled();
  });

  it("does not carry notes for a section whose file the agent deleted", async () => {
    // The section is dropped entirely, so its notes go with it — there is no
    // source for the model to act on.
    notes.open = [note("ghost", "fix this")];
    const attached = await snapshot(["ghost"]);
    expect(attached).toEqual([]);
  });
});

describe("snapshot — element targets (§11)", () => {
  const target = (path: number[], text: string) => ({
    sectionSlug: "hero",
    path,
    tag: "h3",
    text,
    label: text,
    trail: "section > div > h3",
    nth: 0,
  });

  it("sends the file ONCE however many elements inside it are pinned", async () => {
    // The hero is 19KB. Sending it twice because two of its buttons are pinned
    // is exactly the token waste §14 risk 8 is about.
    await write("hero.tsx", "const hero = 1;\n");
    const out = await snapshot([target([0], "One"), target([1], "Two")]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("const hero = 1;\n");
    expect(out[0].targets).toHaveLength(2);
  });

  it("merges a whole-section pin with element pins in the same section", async () => {
    await write("hero.tsx", "const hero = 1;\n");
    const out = await snapshot(["hero", target([0], "One")]);
    expect(out).toHaveLength(1);
    expect(out[0].targets?.map((t) => t.text)).toEqual(["One"]);
  });

  it("OMITS targets entirely for a whole-section pin", async () => {
    // Not `[]`. A whole-section pin has to serialise exactly as it did before
    // elements existed, or every stored row renders differently than it was sent.
    await write("hero.tsx", "const hero = 1;\n");
    const out = await snapshot(["hero"]);
    expect(out[0]).not.toHaveProperty("targets");
  });

  it("keeps the order the sections were pinned in", async () => {
    await write("hero.tsx", "h\n");
    await write("features.tsx", "f\n");
    const out = await snapshot([target([0], "One"), "features", target([1], "Two")]);
    expect(out.map((a) => a.sectionSlug)).toEqual(["hero", "features"]);
  });

  it("drops an element whose section the agent deleted", async () => {
    expect(await snapshot([{ ...target([0], "One"), sectionSlug: "nope" }])).toEqual([]);
  });
});
