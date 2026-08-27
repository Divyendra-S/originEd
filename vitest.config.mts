import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Node by default: almost everything under test is a pure function or a
    // service. The one file that needs a DOM — the preview's inspector contract —
    // opts in with a `// @vitest-environment jsdom` docblock, so the rest of the
    // suite does not pay jsdom's startup on every run.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Test FILES run one at a time. Two of them write to the real workspace —
    // `agent.tools.test.ts` runs add_section/remove_section against the actual
    // manifest.ts and page.tsx, because a fixture copy would not prove the
    // codegen works on the files that ship. Run in parallel workers, that
    // collides with the `against the real files` tests in section.codegen.test.ts,
    // which read the same two files: measured at 2 failures in 15 runs, always
    // the same test, always a manifest that momentarily had a pricing entry in it.
    // The cost is about two seconds on a four-hundred-test suite. A suite that
    // fails one run in eight is worse than a slow one — it teaches you to re-run
    // instead of read. This also holds for whatever real-file test comes next,
    // which is the part moving these two tests into one file would not do.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(root, "./src") },
  },
});
