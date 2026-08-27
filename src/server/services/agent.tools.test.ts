/**
 * The tools are where the agent stops being a chat and starts touching real
 * files. Two properties matter here and are tested for directly:
 *
 *  1. A tool the model used WRONG must come back as `{ error }` it can read and
 *     retry, not as a thrown exception that fails the whole job.
 *  2. Every byte that changes on disk leaves a `file_revisions` row, because
 *     that table is the only record — the diff view and undo have no other source.
 */
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/revision.repo", () => ({
  append: vi.fn(async () => {}),
}));
// Spawning a real compiler per test would cost ~2s each. The parsing is tested
// in `infra/typecheck.test.ts`; what matters here is what the TOOL does with
// each of the three results the checker can produce.
vi.mock("@/server/infra/typecheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/infra/typecheck")>()),
  run: vi.fn(async () => ({ diagnostics: [] })),
}));

import * as typecheck from "@/server/infra/typecheck";
import { WORKSPACE_ROOT } from "@/server/infra/workspace.fs";
import * as revisionRepo from "@/server/repositories/revision.repo";
import { declarations, execute, resetRevisionSeq, type ToolContext } from "./agent.tools";

const SANDBOX = ".tooltest";
const rel = (p: string) => `${SANDBOX}/${p}`;
const abs = (p: string) => path.join(WORKSPACE_ROOT, SANDBOX, p);

const JOB = "job-1";
const ctx: ToolContext = { jobId: JOB, signal: new AbortController().signal };

const call = (name: string, args: Record<string, unknown> = {}) => execute({ name, args }, ctx);
const appended = () => vi.mocked(revisionRepo.append).mock.calls.map((c) => c[0]);

beforeEach(async () => {
  vi.mocked(revisionRepo.append).mockClear();
  resetRevisionSeq(JOB);
  await nodeFs.mkdir(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true });
});

afterEach(async () => {
  await nodeFs.rm(path.join(WORKSPACE_ROOT, SANDBOX), { recursive: true, force: true });
});

describe("declarations", () => {
  it("declares every tool with an object schema Gemini will accept", () => {
    for (const d of declarations) {
      expect(d.name).toMatch(/^[a-z_]+$/);
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.parameters).toMatchObject({ type: "object" });
    }
  });

  it("has no duplicate names", () => {
    expect(new Set(declarations.map((d) => d.name)).size).toBe(declarations.length);
  });
});

describe("read_file", () => {
  it("returns the exact bytes", async () => {
    await nodeFs.writeFile(abs("a.tsx"), "export const A = 1;\n");
    const r = await call("read_file", { path: rel("a.tsx") });
    expect(r.ok).toBe(true);
    expect(r.payload.content).toBe("export const A = 1;\n");
  });

  it("reports a missing file as an error the model can act on", async () => {
    const r = await call("read_file", { path: rel("nope.tsx") });
    expect(r.ok).toBe(false);
    expect(r.payload.error).toContain("does not exist");
  });

  it("turns a jail escape into a tool error, not a thrown job failure", async () => {
    const r = await call("read_file", { path: "../../package.json" });
    expect(r.ok).toBe(false);
    expect(String(r.payload.error)).toContain("escapes the workspace");
  });

  it("rejects a non-string path without throwing", async () => {
    const r = await call("read_file", { path: 42 });
    expect(r.ok).toBe(false);
    expect(r.payload.error).toContain('"path" must be a string');
  });
});

describe("edit_file", () => {
  beforeEach(async () => {
    await nodeFs.writeFile(abs("h.tsx"), "const title = 'old';\nconst sub = 'old';\n");
  });

  it("replaces a unique match and records the revision", async () => {
    const r = await call("edit_file", { path: rel("h.tsx"), old_string: "const title = 'old';", new_string: "const title = 'new';" });
    expect(r.ok).toBe(true);
    expect(await nodeFs.readFile(abs("h.tsx"), "utf8")).toBe("const title = 'new';\nconst sub = 'old';\n");

    expect(appended()).toHaveLength(1);
    expect(appended()[0]).toMatchObject({ jobId: JOB, seq: 1, op: "update", path: rel("h.tsx") });
    expect(appended()[0].before).toContain("'old';\nconst sub");
    expect(appended()[0].after).toContain("'new';");
  });

  it("emits a file_changed change for the caller to publish", async () => {
    const r = await call("edit_file", { path: rel("h.tsx"), old_string: "'old';\nconst sub", new_string: "'x';\nconst sub" });
    expect(r.changes?.[0]).toMatchObject({ type: "file_changed", op: "update", path: rel("h.tsx") });
  });

  it("refuses a zero-hit edit and says to re-read", async () => {
    const r = await call("edit_file", { path: rel("h.tsx"), old_string: "not here", new_string: "x" });
    expect(r.ok).toBe(false);
    expect(String(r.payload.error)).toContain("was not found");
    expect(appended()).toHaveLength(0);
  });

  it("refuses an ambiguous edit rather than guessing which one", async () => {
    const r = await call("edit_file", { path: rel("h.tsx"), old_string: "'old'", new_string: "'new'" });
    expect(r.ok).toBe(false);
    expect(String(r.payload.error)).toContain("appears 2 times");
    expect(await nodeFs.readFile(abs("h.tsx"), "utf8")).toContain("const title = 'old';");
  });

  it("replace_all takes every occurrence", async () => {
    const r = await call("edit_file", { path: rel("h.tsx"), old_string: "'old'", new_string: "'new'", replace_all: true });
    expect(r.ok).toBe(true);
    expect(r.payload.replacements).toBe(2);
    expect(await nodeFs.readFile(abs("h.tsx"), "utf8")).toBe("const title = 'new';\nconst sub = 'new';\n");
  });

  it("rejects a no-op edit", async () => {
    const r = await call("edit_file", { path: rel("h.tsx"), old_string: "x", new_string: "x" });
    expect(r.ok).toBe(false);
    expect(r.payload.error).toContain("identical");
  });

  it("points at write_file when the target does not exist", async () => {
    const r = await call("edit_file", { path: rel("gone.tsx"), old_string: "a", new_string: "b" });
    expect(r.ok).toBe(false);
    expect(String(r.payload.error)).toContain("use write_file");
  });
});

describe("write_file", () => {
  it("creates a file and records op:create with before:null", async () => {
    const r = await call("write_file", { path: rel("new.tsx"), content: "export default null;\n" });
    expect(r.ok).toBe(true);
    expect(appended()[0]).toMatchObject({ op: "create", before: null, after: "export default null;\n" });
  });

  it("records op:update when the file already existed", async () => {
    await nodeFs.writeFile(abs("x.tsx"), "old\n");
    await call("write_file", { path: rel("x.tsx"), content: "new\n" });
    expect(appended()[0]).toMatchObject({ op: "update", before: "old\n", after: "new\n" });
  });

  it("skips the write — and the revision — when content is unchanged", async () => {
    await nodeFs.writeFile(abs("x.tsx"), "same\n");
    const r = await call("write_file", { path: rel("x.tsx"), content: "same\n" });
    expect(r.ok).toBe(true);
    expect(r.changes).toBeUndefined();
    expect(appended()).toHaveLength(0);
  });

  it("refuses an extension outside the allowlist", async () => {
    const r = await call("write_file", { path: rel("evil.sh"), content: "rm -rf /" });
    expect(r.ok).toBe(false);
    expect(String(r.payload.error)).toContain("not writable");
  });
});

describe("delete_file", () => {
  it("deletes and records the previous contents so undo is possible", async () => {
    await nodeFs.writeFile(abs("d.tsx"), "bye\n");
    const r = await call("delete_file", { path: rel("d.tsx") });
    expect(r.ok).toBe(true);
    expect(appended()[0]).toMatchObject({ op: "delete", before: "bye\n", after: null });
    await expect(nodeFs.stat(abs("d.tsx"))).rejects.toThrow();
  });

  it("is an error, not a crash, on a missing file", async () => {
    const r = await call("delete_file", { path: rel("ghost.tsx") });
    expect(r.ok).toBe(false);
    expect(appended()).toHaveLength(0);
  });
});

describe("revision seq", () => {
  it("increments across every mutation in one job, in order", async () => {
    await call("write_file", { path: rel("a.tsx"), content: "1\n" });
    await call("write_file", { path: rel("b.tsx"), content: "2\n" });
    await call("edit_file", { path: rel("a.tsx"), old_string: "1", new_string: "3" });
    expect(appended().map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("restarts at 1 for a new job", async () => {
    await call("write_file", { path: rel("a.tsx"), content: "1\n" });
    resetRevisionSeq(JOB);
    await call("write_file", { path: rel("c.tsx"), content: "2\n" });
    expect(appended().map((r) => r.seq)).toEqual([1, 1]);
  });
});

describe("listing", () => {
  it("list_files returns jail-relative paths", async () => {
    await nodeFs.writeFile(abs("a.tsx"), "1\n");
    const r = await call("list_files", { dir: SANDBOX });
    expect(r.ok).toBe(true);
    expect(r.payload.files).toEqual([rel("a.tsx")]);
  });

  it("list_sections reflects the manifest", async () => {
    const r = await call("list_sections");
    expect(r.ok).toBe(true);
    expect(r.payload.sections).toEqual(expect.arrayContaining([{ slug: "hero", label: "Hero", file: "sections/hero.tsx" }]));
  });
});

describe("typecheck", () => {
  const diagnostic = (over: Partial<typecheck.Diagnostic> = {}): typecheck.Diagnostic => ({
    path: "sections/hero.tsx",
    line: 12,
    column: 5,
    code: "TS2304",
    message: "Cannot find name 'foo'.",
    ...over,
  });

  beforeEach(() => {
    vi.mocked(typecheck.run).mockReset();
    vi.mocked(typecheck.run).mockResolvedValue({ diagnostics: [] });
  });

  it("passes a clean workspace", async () => {
    const out = await call("typecheck");
    expect(out.ok).toBe(true);
    expect(out.payload).toEqual({ ok: true, errors: [] });
  });

  it("reports the errors as text the model can act on", async () => {
    vi.mocked(typecheck.run).mockResolvedValue({ diagnostics: [diagnostic()] });
    const out = await call("typecheck");
    expect(out.ok).toBe(false);
    expect(out.summary).toBe("1 type error");
    expect(out.payload.errors).toContain("sections/hero.tsx(12,5): TS2304");
  });

  it("counts plurally, because the summary is what the user reads", async () => {
    vi.mocked(typecheck.run).mockResolvedValue({
      diagnostics: [diagnostic(), diagnostic({ line: 20 })],
    });
    expect((await call("typecheck")).summary).toBe("2 type errors");
  });

  it("tells the model errors are NOT the same thing as the checker failing", async () => {
    // Reporting a broken toolchain as "no errors" is the dangerous lie: the
    // model would take a broken workspace for a clean one and stop.
    vi.mocked(typecheck.run).mockResolvedValue({ diagnostics: null, error: "tsc: not found" });
    const out = await call("typecheck");
    expect(out.ok).toBe(false);
    expect(out.payload.error).toContain("could not run");
    expect(out.payload).not.toHaveProperty("errors");
  });

  it("writes nothing, so it leaves no revision", async () => {
    await call("typecheck");
    expect(appended()).toEqual([]);
  });
});

describe("unknown tools", () => {
  it("are an error the model can recover from", async () => {
    const r = await call("rm_rf");
    expect(r.ok).toBe(false);
    expect(r.payload.error).toContain('unknown tool "rm_rf"');
  });
});

/**
 * The section tools cannot be sandboxed: they edit `manifest.ts` and `page.tsx`
 * at their real paths, because those two files ARE the page. So this block works
 * on the real ones and puts them back byte for byte afterwards — which also
 * makes it the test that catches the two files drifting away from the anchors
 * in section.codegen.ts, at `vitest run` rather than mid-job.
 */
describe("add_section / remove_section", () => {
  const SECTIONS = path.join(WORKSPACE_ROOT, "sections");
  const NEW_FILE = path.join(SECTIONS, "pricing.tsx");
  let saved: Record<string, string> = {};
  let existed: string[] = [];

  const readReal = (rel: string) => nodeFs.readFile(path.join(WORKSPACE_ROOT, rel), "utf8");

  /**
   * These tests write to the REAL workspace on purpose — the codegen's whole job
   * is editing the actual manifest.ts and page.tsx, and a fixture copy would
   * prove nothing about the files that ship.
   *
   * So the cleanup has to put back exactly what it found, whatever that was. An
   * earlier version saved those two files and then hard-coded
   * `rm sections/pricing.tsx` in afterEach. Run the suite while a real pricing
   * section existed and it deleted it, restored a manifest that still listed it,
   * and left page.tsx importing a file that was no longer there — a broken
   * workspace, from running the tests. Snapshot what is there; remove only what
   * the test itself created.
   */
  beforeEach(async () => {
    saved = {};
    for (const rel of ["manifest.ts", "page.tsx"]) saved[rel] = await readReal(rel);
    existed = (await nodeFs.readdir(SECTIONS)).sort();
    for (const name of existed) saved[`sections/${name}`] = await readReal(`sections/${name}`);
  });

  afterEach(async () => {
    for (const [rel, content] of Object.entries(saved)) {
      // Only rewrite what actually changed: touching hero.tsx on every test
      // would have the dev server recompiling the preview throughout the run.
      if (await readReal(rel).catch(() => null) !== content) {
        await nodeFs.writeFile(path.join(WORKSPACE_ROOT, rel), content, "utf8");
      }
    }
    for (const name of await nodeFs.readdir(SECTIONS)) {
      if (!existed.includes(name)) await nodeFs.rm(path.join(SECTIONS, name), { force: true });
    }
  });

  it("lists the templates with what the model needs to choose one", async () => {
    const r = await call("list_templates");
    expect(r.ok).toBe(true);
    const list = r.payload.templates as { id: string; description: string }[];
    expect(list.map((t) => t.id)).toContain("pricing");
    expect(list.every((t) => t.description.length > 0)).toBe(true);
  });

  it("writes all three files in one call, and records all three", async () => {
    const r = await call("add_section", { slug: "pricing", label: "Pricing", template: "pricing" });
    expect(r.ok).toBe(true);

    expect(r.changes?.map((c) => c.path)).toEqual(["sections/pricing.tsx", "manifest.ts", "page.tsx"]);
    expect(appended().map((a) => [a.path, a.op, a.seq])).toEqual([
      ["sections/pricing.tsx", "create", 1],
      ["manifest.ts", "update", 2],
      ["page.tsx", "update", 3],
    ]);

    expect(await readReal("manifest.ts")).toContain(
      `{ slug: "pricing", label: "Pricing", file: "sections/pricing.tsx" }`,
    );
    const page = await readReal("page.tsx");
    expect(page).toContain(`import Pricing from "./sections/pricing";`);
    expect(page).toContain("  pricing: Pricing,");
  });

  /** The page's own order with "pricing" spliced in behind the hero. */
  const withPricingAfterHero = (base: string[]) =>
    base.flatMap((slug) => (slug === "hero" ? [slug, "pricing"] : [slug]));

  it("names the new section on the ChangeCard, which slugForFile cannot", async () => {
    // The server's imported copy of manifest.ts is stale for a section this very
    // job created (§14 risk 9) — so the slug is passed, not looked up.
    const r = await call("add_section", { slug: "pricing" });
    expect(r.changes?.[0]).toMatchObject({ path: "sections/pricing.tsx", sectionSlug: "pricing" });
  });

  it("list_sections sees a section this same job added", async () => {
    // The regression the first live run walked into. `list_sections` read the
    // statically imported manifest, which does not change while a job runs, so
    // the agent added a third section and was told the page had two — with its
    // own new file missing from the list. A model that believes its section does
    // not exist is one step from adding it a second time.
    //
    // Asserted against the manifest as it actually is, not against a literal
    // list: this runs on the REAL workspace, so hard-coding the page's sections
    // makes adding one to the product break a test about `add_section`.
    const before = await call("list_sections");
    const base = (before.payload.sections as { slug: string }[]).map((s) => s.slug);
    expect(base).toContain("hero");
    expect(base).not.toContain("pricing");

    await call("add_section", { slug: "pricing", label: "Pricing", after: "hero" });

    const after = await call("list_sections");
    expect((after.payload.sections as { slug: string }[]).map((s) => s.slug)).toEqual(
      withPricingAfterHero(base),
    );
  });

  it("names a section this job created even when the slug is not passed in", async () => {
    // `edit_file` does not know the slug; it resolves one from the manifest on
    // disk. Before the fix this came back null and the ChangeCard showed a path.
    await call("add_section", { slug: "pricing", label: "Pricing" });
    const r = await call("edit_file", {
      path: "sections/pricing.tsx",
      old_string: "// Section: Pricing.",
      new_string: "// Section: Pricing plans.",
    });
    expect(r.ok).toBe(true);
    expect(r.changes?.[0]).toMatchObject({ path: "sections/pricing.tsx", sectionSlug: "pricing" });
  });

  it("renders the template into a real component, with no tokens left", async () => {
    await call("add_section", { slug: "pricing", label: "Our plans", template: "pricing" });
    const written = await nodeFs.readFile(NEW_FILE, "utf8");
    expect(written).toContain("export default function Pricing()");
    expect(written).toContain("// Section: Our plans.");
    expect(written).not.toMatch(/__[A-Z]+__/);
  });

  it("defaults to a blank section and a label derived from the slug", async () => {
    const r = await call("add_section", { slug: "logo-wall" });
    expect(r.ok).toBe(true);
    expect(await readReal("manifest.ts")).toContain(`label: "Logo wall"`);
    // A hyphenated slug is not an identifier — the registry key has to be quoted.
    expect(await readReal("page.tsx")).toContain(`"logo-wall": LogoWall,`);
  });

  it("places the section where it was asked to", async () => {
    const before = await call("list_sections");
    const base = (before.payload.sections as { slug: string }[]).map((s) => s.slug);
    const r = await call("add_section", { slug: "pricing", after: "hero" });
    expect(r.payload.order).toEqual(withPricingAfterHero(base));
  });

  it("leaves the workspace untouched when the call cannot succeed", async () => {
    // Everything that can fail is checked BEFORE the first write. Half a section
    // — a file with no manifest entry — is the state that breaks the page.
    for (const args of [
      { slug: "Pricing" },
      { slug: "hero" },
      { slug: "pricing", template: "nope" },
      { slug: "pricing", after: "footer" },
    ]) {
      const r = await call("add_section", args);
      expect(r.ok, JSON.stringify(args)).toBe(false);
      expect(typeof r.payload.error).toBe("string");
    }
    expect(appended()).toEqual([]);
    expect(await readReal("manifest.ts")).toBe(saved["manifest.ts"]);
    expect(await readReal("page.tsx")).toBe(saved["page.tsx"]);
    await expect(nodeFs.stat(NEW_FILE)).rejects.toThrow();
  });

  it("refuses a slug whose file already exists", async () => {
    const r = await call("add_section", { slug: "features" });
    expect(r.ok).toBe(false);
    expect(r.payload.error).toContain("already exists");
  });

  it("removes a section and puts the page back exactly as it was", async () => {
    await call("add_section", { slug: "pricing", template: "cta" });
    resetRevisionSeq(JOB);
    vi.mocked(revisionRepo.append).mockClear();

    const r = await call("remove_section", { slug: "pricing" });
    expect(r.ok).toBe(true);

    // Un-reference first, delete second: no intermediate state names a file
    // that is not there, which would be a broken preview on the way through.
    expect(r.changes?.map((c) => c.path)).toEqual(["manifest.ts", "page.tsx", "sections/pricing.tsx"]);
    expect(appended().map((a) => a.op)).toEqual(["update", "update", "delete"]);
    expect(await readReal("manifest.ts")).toBe(saved["manifest.ts"]);
    expect(await readReal("page.tsx")).toBe(saved["page.tsx"]);
    await expect(nodeFs.stat(NEW_FILE)).rejects.toThrow();
  });

  it("keeps the deleted file's bytes, so undo can put it back", async () => {
    await call("add_section", { slug: "pricing", template: "cta" });
    const written = await nodeFs.readFile(NEW_FILE, "utf8");
    await call("remove_section", { slug: "pricing" });
    const deletion = appended().find((a) => a.op === "delete");
    expect(deletion?.before).toBe(written);
    expect(deletion?.after).toBeNull();
  });

  it("tells the model which sections exist when it names one that does not", async () => {
    const r = await call("remove_section", { slug: "pricing" });
    expect(r.ok).toBe(false);
    expect(r.payload.error).toMatch(/no section called "pricing"/);
    expect(r.payload.error).toContain("hero");
    expect(appended()).toEqual([]);
  });
});
