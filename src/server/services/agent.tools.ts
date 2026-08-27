/**
 * What the agent can actually DO (§7). Every mutation goes through the jail in
 * infra/workspace.fs.ts and leaves a row in `file_revisions` — that table is the
 * source for both the diff view and undo (§12), which is why the recording lives
 * here, at the single choke point, rather than in each tool.
 *
 * Tool failures are NOT job failures. A bad path or a stale `old_string` comes
 * back as `{ error }` in the functionResponse so the model can read it and try
 * again; only an unreachable database or a broken jail throws.
 */
import { DEFAULT_TEMPLATE, findTemplate, templates } from "@/catalog/catalog";
import type { FileOp, JobEventData } from "@/lib/types";
import * as catalog from "@/server/infra/catalog.fs";
import * as typecheck from "@/server/infra/typecheck";
import * as fs from "@/server/infra/workspace.fs";
import * as revisionRepo from "@/server/repositories/revision.repo";
import { sections } from "@/workspace/manifest";
import type { FunctionCall, FunctionDeclaration } from "./gemini.client";
import * as codegen from "./section.codegen";

/** The two files that decide what the page is. Both live in the jail. */
const MANIFEST = "manifest.ts";
const PAGE = "page.tsx";

/** Keeps one tool result from eating the whole context window. */
const MAX_RESULT_CHARS = 60_000;

type FileChange = Extract<JobEventData, { type: "file_changed" }>;

export interface ToolOutcome {
  ok: boolean;
  /** One line for the ToolCard. Written for a human, not the model. */
  summary: string;
  /** Becomes `functionResponse.response` — must be an object, never a bare string. */
  payload: Record<string, unknown>;
  /**
   * One entry per file whose bytes actually changed — a LIST because
   * `add_section` writes three files in a single call, and each still needs its
   * own revision row and its own line on the ChangeCard (§12).
   */
  changes?: FileChange[];
}

export interface ToolContext {
  jobId: string;
  signal: AbortSignal;
}

// ── declarations ──────────────────────────────────────────────────────────────
// Descriptions are prompt surface, not documentation: the model picks tools by
// reading these, so they say when to use one, not just what it does.

export const declarations: FunctionDeclaration[] = [
  {
    name: "list_files",
    description:
      "List files in the workspace, recursively. Call this first if you are unsure what exists.",
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Directory relative to the workspace root. Defaults to the root." },
      },
    },
  },
  {
    name: "list_sections",
    description:
      "List the page's sections in render order, with the file that implements each one. Cheaper than reading the manifest.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description:
      "Read a file's exact current contents. You MUST read a file before editing it — edit_file matches on exact text.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the workspace root, e.g. sections/hero.tsx" } },
      required: ["path"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace an exact string in a file. This is the preferred way to change existing code — it keeps the diff small and reviewable. Fails if old_string is absent or appears more than once, so include enough surrounding lines to be unique.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string", description: "Exact text to replace, copied from read_file output." },
        new_string: { type: "string", description: "Replacement text." },
        replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring exactly one." },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "write_file",
    description:
      "Create a new file, or completely rewrite an existing one. Prefer edit_file for changes to a file that already exists.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_templates",
    description:
      "List the ready-made section templates you can hand to add_section. Call this before adding a section: starting from a template that already matches the request lands a better-looking section in one step than writing markup from scratch.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "add_section",
    description:
      "Add a new section to the page. Does all three edits at once — creates sections/<slug>.tsx from a template, adds the entry to manifest.ts, and wires the import and registry entry into page.tsx — so the page always compiles. Use this instead of writing those three files yourself. Afterwards, read the new file and edit it so the content matches what the user actually asked for.",
    parameters: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: 'Lowercase id, hyphens allowed, e.g. "pricing" or "logo-wall". Becomes the filename and the id used for selection.',
        },
        label: { type: "string", description: 'What a human sees in the chat, e.g. "Pricing". Defaults to the slug, capitalised.' },
        template: { type: "string", description: 'Template id from list_templates. Defaults to "blank".' },
        after: { type: "string", description: "Slug of the section this one should follow. Omit to put it last." },
        before: { type: "string", description: "Slug of the section this one should precede. Ignored if `after` is given." },
      },
      required: ["slug"],
    },
  },
  {
    name: "remove_section",
    description:
      "Remove a section from the page: unwires it from manifest.ts and page.tsx and deletes its file. The change is recorded, so the user can undo it.",
    parameters: {
      type: "object",
      properties: { slug: { type: "string", description: "Slug of the section to remove, as shown by list_sections." } },
      required: ["slug"],
    },
  },
  {
    name: "typecheck",
    description:
      "Type-check the whole workspace and report any errors. Worth calling part-way through a change that spans several files — adding a section, renaming a prop — so you find a mistake while you still have the context to fix it. You do not need to call it at the end: every job is checked automatically before it finishes.",
    parameters: { type: "object", properties: {} },
  },
];

export const NAMES = new Set(declarations.map((d) => d.name));

// ── revision recording ────────────────────────────────────────────────────────

/**
 * Per-job revision counter. `seq` orders the diff view and, later, the order undo
 * has to walk backwards — so it is allocated here, next to the write it labels.
 */
const counters = new Map<string, number>();

export function resetRevisionSeq(jobId: string): void {
  counters.delete(jobId);
}

function nextSeq(jobId: string): number {
  const next = (counters.get(jobId) ?? 0) + 1;
  counters.set(jobId, next);
  return next;
}

/**
 * The sections on the page, read from `manifest.ts` ON DISK.
 *
 * NOT the statically imported `sections`. That binding is the module Turbopack
 * evaluated when the server started, and it does not change while a job runs —
 * so from the moment `add_section` writes the manifest, the static copy is a
 * job-length lie (§14 risk 9). The first live Phase 8 run walked straight into
 * it: the agent added a third section and `list_sections` answered "2 sections",
 * omitting the very file it had just created. A model told its new section does
 * not exist is one plausible step from adding it twice.
 *
 * Falls back to the static import only if the manifest cannot be read or parsed,
 * which is a stale answer but a better one than none.
 */
async function liveSections(): Promise<codegen.NewSection[]> {
  try {
    const source = await fs.readFileIfExists(MANIFEST);
    if (source === null) return [...sections];
    return codegen.manifestEntries(source);
  } catch {
    return [...sections];
  }
}

async function record(
  ctx: ToolContext,
  path: string,
  op: FileOp,
  before: string | null,
  after: string | null,
  /**
   * The section this file belongs to, when the caller already knows it —
   * `add_section` does. Saves the manifest read below; nothing more.
   */
  slug?: string,
): Promise<FileChange> {
  await revisionRepo.append({ jobId: ctx.jobId, seq: nextSeq(ctx.jobId), path, op, before, after });
  // Same staleness, one step later: `edit_file` on a section this job created a
  // few steps ago would resolve to null off the static import and show as a bare
  // path on the ChangeCard. `liveSections` reads the manifest as it is now.
  const resolved = slug ?? (await liveSections()).find((s) => s.file === path)?.slug ?? null;
  return { type: "file_changed", path, op, sectionSlug: resolved };
}

// ── helpers ───────────────────────────────────────────────────────────────────

const fail = (message: string): ToolOutcome => ({
  ok: false,
  summary: message,
  payload: { error: message },
});

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new ArgError(`"${key}" must be a string`);
  return value;
}

class ArgError extends Error {}

function truncate(content: string): { content: string; truncated?: boolean } {
  if (content.length <= MAX_RESULT_CHARS) return { content };
  return { content: content.slice(0, MAX_RESULT_CHARS), truncated: true };
}

const lines = (s: string) => s.split("\n").length;

// ── sections ──────────────────────────────────────────────────────────────────
// Three files, one call. The transforms are pure and live in section.codegen.ts;
// what happens here is ordering: everything that can fail is done BEFORE the
// first byte is written, so the common failure — a duplicate slug, an unknown
// template, a manifest nobody recognises — leaves the workspace untouched.

function optional(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

async function addSection(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome> {
  const slug = str(args, "slug");
  codegen.assertValidSlug(slug);
  const label = codegen.sanitizeLabel(optional(args, "label") ?? codegen.labelFromSlug(slug));

  const id = optional(args, "template") ?? DEFAULT_TEMPLATE;
  const template = findTemplate(id);
  if (!template) {
    return fail(
      `there is no template called "${id}". Call list_templates to see what exists, or omit it for a blank section.`,
    );
  }

  const file = `sections/${slug}.tsx`;
  if (await fs.exists(file)) {
    return fail(`${file} already exists. Pick a different slug, or edit that file instead.`);
  }

  const templateSource = await catalog.readTemplate(template);
  if (templateSource === null) {
    // A listed template with no source is a broken install, not a bad request.
    console.error(`[tools] template "${id}" is listed but ${template.file} could not be read`);
    return fail(`the "${id}" template could not be read. Try another one.`);
  }

  const manifestBefore = await fs.readFileIfExists(MANIFEST);
  const pageBefore = await fs.readFileIfExists(PAGE);
  if (manifestBefore === null || pageBefore === null) {
    return fail(`${manifestBefore === null ? MANIFEST : PAGE} is missing — the page cannot be assembled.`);
  }

  const component = codegen.componentName(slug);
  const content = codegen.renderTemplate(templateSource, { name: component, label });
  const manifestAfter = codegen.insertManifestEntry(
    manifestBefore,
    { slug, label, file },
    { after: optional(args, "after"), before: optional(args, "before") },
  );
  const pageAfter = codegen.insertRegistryEntry(pageBefore, { slug, component });

  // The section file FIRST: no intermediate state may reference a file that is
  // not there yet, because Turbopack recompiles on every one of these writes.
  await fs.writeFile(file, content);
  const changes = [await record(ctx, file, "create", null, content, slug)];
  await fs.writeFile(MANIFEST, manifestAfter);
  changes.push(await record(ctx, MANIFEST, "update", manifestBefore, manifestAfter));
  await fs.writeFile(PAGE, pageAfter);
  changes.push(await record(ctx, PAGE, "update", pageBefore, pageAfter));

  return {
    ok: true,
    summary: `added ${label} from the ${template.name} template`,
    payload: {
      ok: true,
      path: file,
      order: codegen.manifestSlugs(manifestAfter),
      next: `The section is on the page and the page still compiles. Now read ${file} and edit it so the content says what the user asked for.`,
    },
    changes,
  };
}

async function removeSection(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome> {
  const slug = str(args, "slug");

  const manifestBefore = await fs.readFileIfExists(MANIFEST);
  const pageBefore = await fs.readFileIfExists(PAGE);
  if (manifestBefore === null || pageBefore === null) {
    return fail(`${manifestBefore === null ? MANIFEST : PAGE} is missing — the page cannot be assembled.`);
  }

  const entry = codegen.manifestEntries(manifestBefore).find((e) => e.slug === slug);
  const manifestAfter = codegen.removeManifestEntry(manifestBefore, slug); // throws if unknown
  const pageAfter = codegen.removeRegistryEntry(pageBefore, slug);

  // Un-reference FIRST, delete second — the reverse of add, and for the reverse
  // reason: a manifest that still names a file we just deleted is a broken page.
  const changes: FileChange[] = [];
  await fs.writeFile(MANIFEST, manifestAfter);
  changes.push(await record(ctx, MANIFEST, "update", manifestBefore, manifestAfter));
  await fs.writeFile(PAGE, pageAfter);
  changes.push(await record(ctx, PAGE, "update", pageBefore, pageAfter));

  const file = entry?.file ?? `sections/${slug}.tsx`;
  const fileBefore = await fs.readFileIfExists(file);
  if (fileBefore !== null) {
    await fs.deleteFile(file);
    changes.push(await record(ctx, file, "delete", fileBefore, null, slug));
  }

  return {
    ok: true,
    summary: `removed ${entry?.label ?? slug}`,
    payload: { ok: true, order: codegen.manifestSlugs(manifestAfter) },
    changes,
  };
}

// ── the executor ──────────────────────────────────────────────────────────────

export async function execute(call: FunctionCall, ctx: ToolContext): Promise<ToolOutcome> {
  const args = call.args ?? {};
  try {
    switch (call.name) {
      case "list_files": {
        const dir = typeof args.dir === "string" && args.dir.length > 0 ? args.dir : ".";
        const entries = await fs.listFiles(dir);
        const files = entries.filter((e) => e.type === "file").map((e) => e.path);
        return {
          ok: true,
          summary: `${files.length} file${files.length === 1 ? "" : "s"} in ${dir}`,
          payload: { files },
        };
      }

      case "list_sections": {
        const list = await liveSections();
        return { ok: true, summary: `${list.length} section${list.length === 1 ? "" : "s"}`, payload: { sections: list } };
      }

      case "read_file": {
        const path = str(args, "path");
        const content = await fs.readFileIfExists(path);
        if (content === null) return fail(`${path} does not exist`);
        return { ok: true, summary: `read ${path} (${lines(content)} lines)`, payload: truncate(content) };
      }

      case "edit_file": {
        const path = str(args, "path");
        const oldString = str(args, "old_string");
        const newString = str(args, "new_string");
        const replaceAll = args.replace_all === true;

        const before = await fs.readFileIfExists(path);
        if (before === null) return fail(`${path} does not exist — use write_file to create it`);
        if (oldString === newString) return fail("old_string and new_string are identical");

        const hits = before.split(oldString).length - 1;
        if (hits === 0) {
          return fail(
            `old_string was not found in ${path}. Read the file again and copy the text exactly, including indentation.`,
          );
        }
        if (hits > 1 && !replaceAll) {
          return fail(
            `old_string appears ${hits} times in ${path}. Include more surrounding context to make it unique, or pass replace_all: true.`,
          );
        }

        const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
        await fs.writeFile(path, after);
        const change = await record(ctx, path, "update", before, after);
        return {
          ok: true,
          summary: `edited ${path}${hits > 1 ? ` (${hits} occurrences)` : ""}`,
          payload: { ok: true, replacements: replaceAll ? hits : 1 },
          changes: [change],
        };
      }

      case "write_file": {
        const path = str(args, "path");
        const content = str(args, "content");
        const before = await fs.readFileIfExists(path);
        if (before === content) {
          return { ok: true, summary: `${path} already matches — no write`, payload: { ok: true, unchanged: true } };
        }
        await fs.writeFile(path, content);
        const change = await record(ctx, path, before === null ? "create" : "update", before, content);
        return {
          ok: true,
          summary: `${before === null ? "created" : "rewrote"} ${path} (${lines(content)} lines)`,
          payload: { ok: true },
          changes: [change],
        };
      }

      case "delete_file": {
        const path = str(args, "path");
        const before = await fs.readFileIfExists(path);
        if (before === null) return fail(`${path} does not exist`);
        await fs.deleteFile(path);
        const change = await record(ctx, path, "delete", before, null);
        return { ok: true, summary: `deleted ${path}`, payload: { ok: true }, changes: [change] };
      }

      case "list_templates": {
        const list = templates.map((t) => ({ id: t.id, name: t.name, description: t.description, tags: t.tags }));
        return { ok: true, summary: `${list.length} templates`, payload: { templates: list } };
      }

      // `await`, not a bare `return`: a returned promise rejects OUTSIDE this
      // try block, and a CodegenError that escapes here fails the whole job
      // instead of coming back as a tool error the model can act on.
      case "add_section":
        return await addSection(ctx, args);

      case "remove_section":
        return await removeSection(ctx, args);

      case "typecheck": {
        const result = await typecheck.run(ctx.signal);

        // The checker not running is OUR problem, and it is reported as one.
        // Reporting it as "no errors" would be the dangerous lie here: the
        // model would take a broken workspace for a clean one.
        if (result.diagnostics === null) {
          return fail(`the type checker could not run: ${result.error ?? "unknown reason"}`);
        }

        const errors = result.diagnostics;
        if (errors.length === 0) {
          return { ok: true, summary: "type check passed", payload: { ok: true, errors: [] } };
        }

        return {
          ok: false,
          summary: `${errors.length} type error${errors.length === 1 ? "" : "s"}`,
          payload: {
            ok: false,
            errors: typecheck.format(errors),
            hint: "Read each file listed, fix the error, and check again. Paths are relative to the workspace root.",
          },
        };
      }

      default:
        return fail(`unknown tool "${call.name}"`);
    }
  } catch (err) {
    if (err instanceof ArgError) return fail(err.message);
    if (err instanceof fs.WorkspaceError) return fail(err.message);
    // A slug that is not a slug, a manifest we do not recognise, a name already
    // taken — all things the model can pick differently on the next call.
    if (err instanceof codegen.CodegenError) return fail(err.message);
    // A jail violation or a bad argument is the model's problem to fix. Anything
    // else — Postgres down, disk full — is ours, and must fail the job loudly.
    throw err;
  }
}
