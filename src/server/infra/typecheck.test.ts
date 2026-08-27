/**
 * Parsing `tsc` output (§7).
 *
 * The parsing is worth its own tests because of what depends on it: the agent
 * gets one shot at reading these paths and calling `read_file` on them, and a
 * path it cannot pass back — `src/workspace/sections/hero.tsx` where every
 * other tool says `sections/hero.tsx` — turns a fix into a guess.
 *
 * `run()` is not tested here. It spawns a real compiler over the real jail;
 * `agent.tools.test.ts` covers what the tool does with the result, and the live
 * runs cover the spawn.
 */
import { describe, expect, it } from "vitest";
import { MAX_REPORTED, format, parse } from "./typecheck";

const line = (file: string, row: number, col: number, code: string, message: string) =>
  `${file}(${row},${col}): error ${code}: ${message}`;

describe("parse", () => {
  it("reads a diagnostic into its parts", () => {
    const [d] = parse(
      line("src/workspace/sections/hero.tsx", 12, 5, "TS2304", "Cannot find name 'foo'."),
    );
    expect(d).toEqual({
      path: "sections/hero.tsx",
      line: 12,
      column: 5,
      code: "TS2304",
      message: "Cannot find name 'foo'.",
    });
  });

  it("strips the jail prefix, so the path is one the agent can pass to read_file", () => {
    const [d] = parse(line("src/workspace/manifest.ts", 3, 1, "TS1005", "',' expected."));
    expect(d.path).toBe("manifest.ts");
  });

  it("leaves a path outside the jail alone rather than mangling it", () => {
    // Shouldn't happen with the scoped config, but silently rewriting a path
    // that doesn't start with the prefix would produce a plausible-looking lie.
    const [d] = parse(line("node_modules/foo/index.d.ts", 1, 1, "TS2307", "Cannot find module."));
    expect(d.path).toBe("node_modules/foo/index.d.ts");
  });

  it("reads several diagnostics from one run", () => {
    const raw = [
      line("src/workspace/sections/hero.tsx", 1, 1, "TS1005", "';' expected."),
      line("src/workspace/page.tsx", 9, 3, "TS2739", "Type is missing properties."),
    ].join("\n");
    expect(parse(raw).map((d) => d.path)).toEqual(["sections/hero.tsx", "page.tsx"]);
  });

  it("keeps the indented explanation, which is the useful half of the message", () => {
    const raw = [
      line("src/workspace/page.tsx", 9, 3, "TS2322", "Type 'A' is not assignable to type 'B'."),
      "  Property 'slug' is missing in type 'A'.",
    ].join("\n");
    expect(parse(raw)[0].message).toBe(
      "Type 'A' is not assignable to type 'B'. Property 'slug' is missing in type 'A'.",
    );
  });

  it("does not attach a continuation to nothing when output starts indented", () => {
    expect(parse("  orphaned continuation\n")).toEqual([]);
  });

  it("ignores lines that are not diagnostics", () => {
    const raw = ["Found 1 error in 1 file.", "", line("src/workspace/x.ts", 1, 1, "TS1", "x")].join("\n");
    expect(parse(raw)).toHaveLength(1);
  });

  it("returns nothing for a clean run", () => {
    expect(parse("")).toEqual([]);
  });

  it("ignores a warning — only errors gate a job", () => {
    expect(parse("src/workspace/x.ts(1,1): warning TS6133: 'x' is declared but never used.")).toEqual(
      [],
    );
  });

  it("handles a message containing parentheses without truncating it", () => {
    const [d] = parse(
      line("src/workspace/x.ts", 4, 2, "TS2554", "Expected 1 arguments, but got 2 (see above)."),
    );
    expect(d.message).toBe("Expected 1 arguments, but got 2 (see above).");
  });
});

describe("format", () => {
  it("renders one line per error, in the agent's own path vocabulary", () => {
    const raw = line("src/workspace/sections/hero.tsx", 12, 5, "TS2304", "Cannot find name 'foo'.");
    expect(format(parse(raw))).toBe("sections/hero.tsx(12,5): TS2304: Cannot find name 'foo'.");
  });

  it("caps the list and says how many it dropped", () => {
    // A wall of 300 errors is one broken import repeated; the model needs the
    // first few and the fact that there are more, not the whole transcript.
    const many = Array.from({ length: MAX_REPORTED + 7 }, (_, i) =>
      line("src/workspace/x.ts", i + 1, 1, "TS2304", "Cannot find name 'foo'."),
    ).join("\n");
    const out = format(parse(many));
    expect(out.split("\n")).toHaveLength(MAX_REPORTED + 1);
    expect(out).toContain("…and 7 more.");
  });

  it("is empty for a clean run", () => {
    expect(format([])).toBe("");
  });
});
