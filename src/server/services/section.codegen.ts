/**
 * Adding a section, as an edit to two files the shape of which we control (§7).
 *
 * §7 originally dropped `add_section` on the grounds that it is three edits to
 * files already in the jail and a tool would be a fourth way to write the same
 * bytes. That held until Phase 7 measured what those three edits cost when they
 * go wrong: the manifest and the registry have to agree or `page.tsx` does not
 * compile, and a repair round is 49.5k tokens against 15k for a clean turn. The
 * model can get this right; it just has to get it right three times in a row,
 * from memory, with exact-match edits. Doing it here instead means the error is
 * impossible rather than caught.
 *
 * EVERYTHING IN THIS FILE IS PURE — strings in, strings out, no fs, no model.
 * That is deliberate and it is the only reason the edge cases below (an empty
 * manifest, a slug that is not an identifier, a name already imported) can be
 * tested at all: they are all reachable in a unit test and none of them are
 * reachable in a live run without paying for one.
 *
 * The transforms are line-based, not AST-based. A parser would be more general
 * than the problem: these are two files this project wrote and the agent is
 * told not to reformat, and a shape we do not recognise must fail loudly with
 * "edit it by hand" rather than be quietly re-serialised into something else.
 */

/** A malformed input the MODEL can act on — never a job failure. */
export class CodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodegenError";
  }
}

export interface NewSection {
  slug: string;
  label: string;
  /** Jail-relative, e.g. `sections/pricing.tsx`. */
  file: string;
}

/** Where the new entry goes. Both are slugs of sections already on the page. */
export interface Placement {
  after?: string;
  before?: string;
}

// ── names ─────────────────────────────────────────────────────────────────────

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 32;
const MAX_LABEL = 48;

/** Files the section tools must never create or delete under `sections/`. */
const RESERVED = new Set(["page", "manifest", "index", "layout"]);

export function assertValidSlug(slug: string): void {
  if (!SLUG.test(slug)) {
    throw new CodegenError(
      `"${slug}" is not a valid section slug. Use lowercase letters, digits and single hyphens, starting with a letter — for example "pricing" or "logo-wall".`,
    );
  }
  if (slug.length > MAX_SLUG) {
    throw new CodegenError(`"${slug}" is longer than ${MAX_SLUG} characters.`);
  }
  if (RESERVED.has(slug)) {
    throw new CodegenError(`"${slug}" is reserved. Pick another name for the section.`);
  }
}

/** `logo-wall` → `LogoWall`. The component name and the default import in page.tsx. */
export function componentName(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** `logo-wall` → `Logo wall`. Only used when the caller did not supply a label. */
export function labelFromSlug(slug: string): string {
  const words = slug.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The label ends up inside a double-quoted string literal in manifest.ts, so a
 * quote or a newline in it would not be a bad label — it would be a syntax
 * error in the user's page. Stripped rather than rejected: this is the one
 * argument the model writes freehand, and failing a whole tool call over a
 * stray apostrophe-style quote helps nobody.
 */
export function sanitizeLabel(label: string): string {
  const clean = label.replace(/["\\\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  if (clean.length === 0) throw new CodegenError("label cannot be empty");
  return clean;
}

/** Substitute the catalog's two tokens. Both are valid where they appear, so the
 *  template file itself still parses and type-checks in `src/catalog/`. */
export function renderTemplate(source: string, vars: { name: string; label: string }): string {
  return source.split("__NAME__").join(vars.name).split("__LABEL__").join(vars.label);
}

// ── manifest.ts ───────────────────────────────────────────────────────────────

/**
 * One entry line of the manifest, parsed key by key rather than as one shape:
 * we write `{ slug, label, file }` in that order, but a human may not have, and
 * a reordered key is not a reason to refuse to add a section.
 */
export function parseEntry(line: string): NewSection | null {
  const slug = line.match(/slug:\s*["']([^"']+)["']/)?.[1];
  if (!slug || !/^\s*\{/.test(line)) return null;
  return {
    slug,
    label: line.match(/label:\s*["']([^"']*)["']/)?.[1] ?? slug,
    file: line.match(/file:\s*["']([^"']+)["']/)?.[1] ?? `sections/${slug}.tsx`,
  };
}

/** The half-open range of entry lines inside the `sections` array. */
function manifestBounds(lines: string[]): { first: number; close: number } {
  const open = lines.findIndex((line) => /export\s+const\s+sections\s*=\s*\[/.test(line));
  if (open === -1) {
    throw new CodegenError(
      "could not find the `sections` array in manifest.ts. Read the file and edit it with edit_file instead.",
    );
  }
  const close = lines.findIndex((line, i) => i > open && /^\s*\]/.test(line));
  if (close === -1) {
    throw new CodegenError(
      "could not find the end of the `sections` array in manifest.ts. Read the file and edit it with edit_file instead.",
    );
  }
  return { first: open + 1, close };
}

/** Slugs in render order, read out of the manifest SOURCE rather than the
 *  imported module — the server's copy of `manifest.ts` is stale mid-job (§14
 *  risk 9), and this runs after the same job may already have written it. */
export function manifestEntries(source: string): NewSection[] {
  const lines = source.split("\n");
  const { first, close } = manifestBounds(lines);
  const entries: NewSection[] = [];
  for (let i = first; i < close; i++) {
    const entry = parseEntry(lines[i]);
    if (entry) entries.push(entry);
  }
  return entries;
}

export function manifestSlugs(source: string): string[] {
  return manifestEntries(source).map((e) => e.slug);
}

function indexOfSlug(lines: string[], first: number, close: number, slug: string): number {
  for (let i = first; i < close; i++) {
    if (parseEntry(lines[i])?.slug === slug) return i;
  }
  return -1;
}

function unknown(slug: string, known: string[]): CodegenError {
  return new CodegenError(
    `there is no section called "${slug}" on the page. The sections are: ${known.join(", ") || "(none)"}.`,
  );
}

export function insertManifestEntry(source: string, entry: NewSection, place: Placement = {}): string {
  const lines = source.split("\n");
  const { first, close } = manifestBounds(lines);
  const existing = manifestSlugs(source);

  if (existing.includes(entry.slug)) {
    throw new CodegenError(
      `a section called "${entry.slug}" is already on the page. Pick a different slug, or edit the existing one.`,
    );
  }

  let at = close; // default: last on the page
  if (place.after !== undefined) {
    const i = indexOfSlug(lines, first, close, place.after);
    if (i === -1) throw unknown(place.after, existing);
    at = i + 1;
  } else if (place.before !== undefined) {
    const i = indexOfSlug(lines, first, close, place.before);
    if (i === -1) throw unknown(place.before, existing);
    at = i;
  }

  lines.splice(at, 0, `  { slug: "${entry.slug}", label: "${entry.label}", file: "${entry.file}" },`);
  return lines.join("\n");
}

export function removeManifestEntry(source: string, slug: string): string {
  const lines = source.split("\n");
  const { first, close } = manifestBounds(lines);
  const i = indexOfSlug(lines, first, close, slug);
  if (i === -1) throw unknown(slug, manifestSlugs(source));
  lines.splice(i, 1);
  return lines.join("\n");
}

// ── page.tsx ──────────────────────────────────────────────────────────────────

const SECTION_IMPORT = /^import\s+(\w+)\s+from\s+["']\.\/sections\/([\w-]+)["'];?\s*$/;
const ANY_IMPORT = /^import\s/;

/** The `{ … }` body of `const registry` — where the slug → component map lives. */
function registryBounds(lines: string[]): { first: number; close: number } {
  const open = lines.findIndex((line) => /const\s+registry\b/.test(line));
  if (open === -1) {
    throw new CodegenError(
      "could not find `const registry` in page.tsx. Read the file and edit it with edit_file instead.",
    );
  }
  const close = lines.findIndex((line, i) => i > open && /^\s*\}/.test(line));
  if (close === -1) {
    throw new CodegenError(
      "could not find the end of `const registry` in page.tsx. Read the file and edit it with edit_file instead.",
    );
  }
  return { first: open + 1, close };
}

/**
 * A slug is `logo-wall`; an object key has to be `"logo-wall"`. Getting this
 * wrong produces a file that looks right and does not parse, which is the most
 * expensive kind of wrong here — the model would be handed a syntax error in a
 * file it never wrote.
 */
function registryKey(slug: string): string {
  return /^[a-z][a-z0-9]*$/.test(slug) ? slug : `"${slug}"`;
}

export function insertRegistryEntry(source: string, entry: { slug: string; component: string }): string {
  const lines = source.split("\n");
  const { close } = registryBounds(lines);

  // Every import line, not just the section ones: `page.tsx` also imports
  // `SectionBoundary` from outside the jail, and a slug of `section-boundary`
  // would shadow it with a component that renders nothing like it.
  const taken = new RegExp(`\\b${entry.component}\\b`);
  if (lines.some((line) => ANY_IMPORT.test(line) && taken.test(line))) {
    throw new CodegenError(
      `page.tsx already imports something called ${entry.component}. Pick a slug that does not collide with it.`,
    );
  }

  // Import first — inserting it shifts every line after it, so the registry
  // bounds are computed BEFORE and the offset applied by hand.
  const importLine = `import ${entry.component} from "./sections/${entry.slug}";`;
  let importAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_IMPORT.test(lines[i])) importAt = i + 1;
  }
  if (importAt === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (ANY_IMPORT.test(lines[i])) importAt = i + 1;
    }
  }
  if (importAt === -1) {
    throw new CodegenError(
      "could not find the imports in page.tsx. Read the file and edit it with edit_file instead.",
    );
  }

  lines.splice(importAt, 0, importLine);
  const shift = importAt <= close ? 1 : 0;
  lines.splice(close + shift, 0, `  ${registryKey(entry.slug)}: ${entry.component},`);
  return lines.join("\n");
}

/**
 * Tolerant on purpose, unlike its manifest twin. Whether the section exists is
 * decided by the manifest; by the time this runs that question is answered, and
 * a page.tsx missing one of the two lines is a half-finished state we should
 * finish rather than refuse.
 */
export function removeRegistryEntry(source: string, slug: string): string {
  const lines = source.split("\n");
  const { first, close } = registryBounds(lines);
  const key = new RegExp(`^\\s*["']?${slug}["']?\\s*:`);

  const drop = new Set<number>();
  for (let i = first; i < close; i++) {
    if (key.test(lines[i])) drop.add(i);
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(SECTION_IMPORT)?.[2] === slug) drop.add(i);
  }

  return lines.filter((_, i) => !drop.has(i)).join("\n");
}
