/**
 * The catalog is data that becomes somebody's page. These tests are the reason
 * a template can be trusted to land without being read first:
 *
 *  - it exists, and it is a section (a default export, one root element)
 *  - it is SELF-CONTAINED. A template with an import lands in a workspace where
 *    that path does not resolve, and the first thing the user sees is a broken
 *    preview from a section they did not write.
 *  - nothing is left un-substituted, in either direction
 *
 * That the templates COMPILE is not asserted here — it is asserted by `tsc`,
 * which is the point of keeping them as real .tsx files in the project rather
 * than as string literals.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/server/services/section.codegen";
import { DEFAULT_TEMPLATE, findTemplate, templates } from "./catalog";

const read = (file: string) => fs.readFile(path.resolve(process.cwd(), "src/catalog", file), "utf8");

describe("the catalog", () => {
  it("has unique ids the model can pass straight to add_section", () => {
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
    for (const t of templates) expect(t.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("describes each template well enough to choose one without reading it", () => {
    // This is prompt surface, not documentation: the description is all the
    // model has when it picks between "pricing" and "cta".
    for (const t of templates) {
      expect(t.description.length, t.id).toBeGreaterThan(40);
      expect(t.tags.length, t.id).toBeGreaterThan(1);
    }
  });

  it("resolves the default", () => {
    expect(findTemplate(DEFAULT_TEMPLATE)).not.toBeNull();
    expect(findTemplate("no-such-template")).toBeNull();
  });
});

describe("every template file", () => {
  it.each(templates.map((t) => [t.id, t.file] as const))("%s is a self-contained section", async (id, file) => {
    const source = await read(file);

    expect(source, id).toContain("export default function __NAME__()");
    expect(source, id).toContain("__LABEL__");

    // No imports, at all. There is no module graph on the other side of the
    // copy — `sections/<slug>.tsx` sits in a jail that cannot see src/catalog.
    expect(source.split("\n").filter((l) => /^\s*import\s/.test(l)), id).toEqual([]);

    // Substitution is total, and it does not leave a token behind by only
    // replacing the first occurrence.
    const rendered = renderTemplate(source, { name: "LogoWall", label: "Logo wall" });
    expect(rendered, id).not.toMatch(/__[A-Z]+__/);
    expect(rendered, id).toContain("export default function LogoWall()");
  });

  it.each(templates.map((t) => [t.id, t.file] as const))("%s stays inside the size cap", async (id, file) => {
    // The jail refuses a write over 256KB; a template that trips it would fail
    // at the last moment, after the manifest has already been edited.
    const source = await read(file);
    expect(Buffer.byteLength(source, "utf8"), id).toBeLessThan(64 * 1024);
  });
});
