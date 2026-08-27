/**
 * Adding a section is three edits that have to agree, and the type checker only
 * tells you afterwards — at the price of a repair round (§7). So these tests are
 * the phase: every way the transform can be wrong is cheap to provoke here and
 * expensive to discover live.
 *
 * Two properties get asserted over and over, because they are what "codegen you
 * can trust in someone's page" actually means:
 *
 *  1. It changes ONE line and leaves every other byte alone. The agent is told
 *     not to reformat; a tool that reformats on its behalf is worse.
 *  2. Insert-then-remove is the identity. If it is not, undo is not either.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertValidSlug,
  CodegenError,
  componentName,
  insertManifestEntry,
  insertRegistryEntry,
  labelFromSlug,
  manifestEntries,
  manifestSlugs,
  parseEntry,
  removeManifestEntry,
  removeRegistryEntry,
  renderTemplate,
  sanitizeLabel,
} from "./section.codegen";

const MANIFEST = `export interface SectionEntry {
  slug: string;
  label: string;
  file: string;
}

export const sections = [
  { slug: "hero", label: "Hero", file: "sections/hero.tsx" },
  { slug: "features", label: "Features", file: "sections/features.tsx" },
] as const satisfies readonly SectionEntry[];

export type SectionSlug = (typeof sections)[number]["slug"];
`;

const PAGE = `import type { ComponentType } from "react";
import { SectionBoundary } from "@/app/(preview)/_runtime/SectionBoundary";
import { sections, type SectionSlug } from "./manifest";
import Features from "./sections/features";
import Hero from "./sections/hero";

const registry: Record<SectionSlug, ComponentType> = {
  hero: Hero,
  features: Features,
};

export function WorkspacePage() {
  return <>{sections.map(({ slug }) => registry[slug])}</>;
}
`;

const PRICING = { slug: "pricing", label: "Pricing", file: "sections/pricing.tsx" };

/** The lines `after` has that `before` did not, in order. Insert-only, which is
 *  all these transforms ever do — anything else shows up as a bogus extra line. */
const added = (before: string, after: string) => {
  const old = before.split("\n");
  const out: string[] = [];
  let i = 0;
  for (const line of after.split("\n")) {
    if (i < old.length && old[i] === line) i++;
    else out.push(line);
  }
  return out;
};

describe("slugs, names and labels", () => {
  it("accepts the shapes a section slug is allowed to take", () => {
    for (const slug of ["hero", "pricing", "logo-wall", "faq2", "a-b-c"]) {
      expect(() => assertValidSlug(slug)).not.toThrow();
    }
  });

  it("rejects everything that would not survive being a filename or an id", () => {
    for (const slug of ["Pricing", "-pricing", "pricing-", "pri--cing", "pricing_table", "2cool", "", "a b"]) {
      expect(() => assertValidSlug(slug), slug).toThrow(CodegenError);
    }
  });

  it("refuses the names that would collide with the files that assemble the page", () => {
    expect(() => assertValidSlug("page")).toThrow(/reserved/);
    expect(() => assertValidSlug("manifest")).toThrow(/reserved/);
  });

  it("derives a component name and a label from the slug", () => {
    expect(componentName("logo-wall")).toBe("LogoWall");
    expect(componentName("faq")).toBe("Faq");
    expect(labelFromSlug("logo-wall")).toBe("Logo wall");
  });

  it("strips what would break the string literal the label ends up inside", () => {
    // Not a cosmetic concern: an unescaped quote here is a syntax error in
    // manifest.ts, in a file the model never wrote and cannot see.
    expect(sanitizeLabel('Our "best" plans')).toBe("Our best plans");
    expect(sanitizeLabel("two\nlines")).toBe("two lines");
    expect(sanitizeLabel("  padded  ")).toBe("padded");
    expect(sanitizeLabel("x".repeat(80))).toHaveLength(48);
    expect(() => sanitizeLabel('  "" ')).toThrow(CodegenError);
  });

  it("substitutes every occurrence of both template tokens", () => {
    const out = renderTemplate("// __LABEL__\nexport default function __NAME__() { return <p>__LABEL__</p>; }", {
      name: "LogoWall",
      label: "Logo wall",
    });
    expect(out).not.toMatch(/__NAME__|__LABEL__/);
    expect(out.split("Logo wall")).toHaveLength(3);
  });
});

describe("reading the manifest", () => {
  it("reads entries out of the SOURCE, not the imported module", () => {
    // The imported module is stale for a section this job just created (risk 9),
    // which is exactly when the tool needs to know the order.
    expect(manifestSlugs(MANIFEST)).toEqual(["hero", "features"]);
    expect(manifestEntries(MANIFEST)[1]).toEqual({
      slug: "features",
      label: "Features",
      file: "sections/features.tsx",
    });
  });

  it("parses an entry whose keys are in another order", () => {
    expect(parseEntry(`  { file: "sections/x.tsx", slug: "x", label: "X" },`)).toEqual({
      slug: "x",
      label: "X",
      file: "sections/x.tsx",
    });
  });

  it("is not fooled by a slug mentioned outside an entry", () => {
    expect(parseEntry(`export type SectionSlug = "hero";`)).toBeNull();
  });
});

describe("insertManifestEntry", () => {
  it("appends by default and touches nothing else", () => {
    const out = insertManifestEntry(MANIFEST, PRICING);
    expect(manifestSlugs(out)).toEqual(["hero", "features", "pricing"]);
    expect(added(MANIFEST, out)).toEqual([
      `  { slug: "pricing", label: "Pricing", file: "sections/pricing.tsx" },`,
    ]);
    expect(out.split("\n")).toHaveLength(MANIFEST.split("\n").length + 1);
  });

  it("places by `after`", () => {
    expect(manifestSlugs(insertManifestEntry(MANIFEST, PRICING, { after: "hero" }))).toEqual([
      "hero",
      "pricing",
      "features",
    ]);
  });

  it("places by `before`", () => {
    expect(manifestSlugs(insertManifestEntry(MANIFEST, PRICING, { before: "hero" }))).toEqual([
      "pricing",
      "hero",
      "features",
    ]);
  });

  it("prefers `after` when the model sends both", () => {
    expect(
      manifestSlugs(insertManifestEntry(MANIFEST, PRICING, { after: "hero", before: "hero" })),
    ).toEqual(["hero", "pricing", "features"]);
  });

  it("names the sections that DO exist when the anchor does not", () => {
    // The message is the whole point: the model gets one shot at picking again.
    expect(() => insertManifestEntry(MANIFEST, PRICING, { after: "footer" })).toThrow(
      /no section called "footer"[\s\S]*hero, features/,
    );
  });

  it("refuses a slug already on the page", () => {
    expect(() => insertManifestEntry(MANIFEST, { ...PRICING, slug: "hero" })).toThrow(/already on the page/);
  });

  it("works on an empty page", () => {
    const empty = MANIFEST.replace(/^  \{ slug.*\n/gm, "");
    expect(manifestSlugs(insertManifestEntry(empty, PRICING))).toEqual(["pricing"]);
  });

  it("tells the model to edit by hand when the file is not a shape we know", () => {
    expect(() => insertManifestEntry("export const other = [];\n", PRICING)).toThrow(/edit_file/);
    expect(() => insertManifestEntry("export const sections = [\n", PRICING)).toThrow(/end of the/);
  });
});

describe("removeManifestEntry", () => {
  it("removes exactly one line", () => {
    const out = removeManifestEntry(MANIFEST, "hero");
    expect(manifestSlugs(out)).toEqual(["features"]);
    expect(out.split("\n")).toHaveLength(MANIFEST.split("\n").length - 1);
  });

  it("round-trips with insert", () => {
    expect(removeManifestEntry(insertManifestEntry(MANIFEST, PRICING), "pricing")).toBe(MANIFEST);
    expect(removeManifestEntry(insertManifestEntry(MANIFEST, PRICING, { after: "hero" }), "pricing")).toBe(
      MANIFEST,
    );
  });

  it("errors on a section that is not there", () => {
    expect(() => removeManifestEntry(MANIFEST, "pricing")).toThrow(CodegenError);
  });
});

describe("insertRegistryEntry", () => {
  it("adds the import and the registry entry, and nothing else", () => {
    const out = insertRegistryEntry(PAGE, { slug: "pricing", component: "Pricing" });
    expect(added(PAGE, out)).toEqual([
      `import Pricing from "./sections/pricing";`,
      "  pricing: Pricing,",
    ]);
    expect(out.split("\n")).toHaveLength(PAGE.split("\n").length + 2);
  });

  it("puts the entry INSIDE the registry object", () => {
    // Off by one here compiles as a stray statement or does not compile at all,
    // and either way the section silently never renders.
    const lines = insertRegistryEntry(PAGE, { slug: "pricing", component: "Pricing" }).split("\n");
    const open = lines.findIndex((l) => l.includes("const registry"));
    const close = lines.findIndex((l, i) => i > open && l.startsWith("}"));
    const entry = lines.findIndex((l) => l.includes("pricing: Pricing"));
    expect(entry).toBeGreaterThan(open);
    expect(entry).toBeLessThan(close);
  });

  it("quotes a key that is not an identifier", () => {
    const out = insertRegistryEntry(PAGE, { slug: "logo-wall", component: "LogoWall" });
    expect(out).toContain(`  "logo-wall": LogoWall,`);
    expect(out).toContain(`import LogoWall from "./sections/logo-wall";`);
  });

  it("refuses a component name page.tsx already imports — including from outside the jail", () => {
    // `section-boundary` is the one that matters: SectionBoundary is imported
    // from outside the workspace and shadowing it breaks selection everywhere.
    expect(() => insertRegistryEntry(PAGE, { slug: "section-boundary", component: "SectionBoundary" })).toThrow(
      /already imports something called SectionBoundary/,
    );
    expect(() => insertRegistryEntry(PAGE, { slug: "hero", component: "Hero" })).toThrow(/already imports/);
  });

  it("tells the model to edit by hand when there is no registry", () => {
    expect(() => insertRegistryEntry("export const x = 1;\n", { slug: "a", component: "A" })).toThrow(
      /edit_file/,
    );
  });
});

describe("removeRegistryEntry", () => {
  it("drops both lines", () => {
    const out = removeRegistryEntry(PAGE, "hero");
    expect(out).not.toContain("Hero");
    expect(out.split("\n")).toHaveLength(PAGE.split("\n").length - 2);
  });

  it("round-trips with insert", () => {
    expect(removeRegistryEntry(insertRegistryEntry(PAGE, { slug: "pricing", component: "Pricing" }), "pricing")).toBe(
      PAGE,
    );
  });

  it("finishes a half-finished removal instead of refusing", () => {
    // Whether the section exists is the manifest's answer, not page.tsx's. By
    // the time this runs the question is settled, and a file missing one of the
    // two lines is a state to clean up, not one to argue with.
    const halfway = PAGE.replace(`import Hero from "./sections/hero";\n`, "");
    expect(removeRegistryEntry(halfway, "hero")).not.toContain("hero: Hero");
    expect(removeRegistryEntry(PAGE, "nothing-like-this")).toBe(PAGE);
  });

  it("leaves a same-named key outside the registry alone", () => {
    const decoy = PAGE.replace("export function WorkspacePage", `const other = { hero: 1 };\nexport function WorkspacePage`);
    expect(removeRegistryEntry(decoy, "hero")).toContain("const other = { hero: 1 };");
  });
});

describe("against the real files", () => {
  // The anchors are regexes over two files this project maintains by hand. If
  // either is ever reformatted, the failure belongs here — at `npx vitest run` —
  // and not in a live job that has already spent tokens getting to the call.
  const read = (rel: string) => fs.readFile(path.resolve(process.cwd(), "src/workspace", rel), "utf8");

  it("adds a section to the manifest that is actually on disk", async () => {
    const source = await read("manifest.ts");
    expect(manifestSlugs(source)).toContain("hero");
    const out = insertManifestEntry(source, PRICING, { after: "hero" });
    expect(manifestSlugs(out)).toEqual(["hero", "pricing", ...manifestSlugs(source).slice(1)]);
    expect(removeManifestEntry(out, "pricing")).toBe(source);
  });

  it("wires a section into the page.tsx that is actually on disk", async () => {
    const source = await read("page.tsx");
    const out = insertRegistryEntry(source, { slug: "pricing", component: "Pricing" });
    expect(out).toContain(`import Pricing from "./sections/pricing";`);
    expect(out).toContain("  pricing: Pricing,");
    expect(removeRegistryEntry(out, "pricing")).toBe(source);
  });
});
