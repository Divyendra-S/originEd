/**
 * Layer 3 · infra — reading the section catalog off disk (§7, Phase 8).
 *
 * The mirror image of `workspace.fs.ts`, and much smaller because it is
 * READ-ONLY and its paths never come from the model: a tool looks an id up in
 * `catalog.ts` first and passes the entry here, so there is no user-controlled
 * string to escape with. The containment check is kept anyway — it costs
 * nothing and it is the reason nobody has to re-derive that argument later.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Template } from "@/catalog/catalog";

export const CATALOG_ROOT = path.resolve(process.cwd(), "src/catalog");

/**
 * The template's source, exactly as written.
 *
 * Returns null when the file is missing — a listed template with no source is a
 * broken install, not a broken request, but it reaches the model as a tool error
 * it can route around (pick another template) rather than a failed job.
 */
export async function readTemplate(template: Template): Promise<string | null> {
  const abs = path.resolve(CATALOG_ROOT, template.file);
  if (!abs.startsWith(CATALOG_ROOT + path.sep)) return null;
  try {
    return await fs.readFile(abs, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
