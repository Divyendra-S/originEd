"use client";

/**
 * One tool call, as the user sees it: appears the moment `tool_call` arrives,
 * spins while the agent works, resolves on `tool_result`.
 *
 * A hairline row, not a card. These scroll past six or eight times a turn, and
 * eight bordered boxes stacked on a panel is the single noisiest thing in the
 * transcript — it makes a working agent look frantic and it buries the prose
 * that is actually the answer. The rail on the left of the group does the
 * grouping that eight borders were doing badly.
 */
import { Check, X } from "lucide-react";
import type { ToolCallView } from "@/hooks/useJobStream";

const LABELS: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  delete_file: "Delete",
  list_files: "List",
  list_sections: "Sections",
  typecheck: "Typecheck",
};

/** The one argument worth showing inline — a path beats `{"path":"…","find":"…"}`. */
function subject(tool: ToolCallView): string | null {
  const args = tool.args;
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file", "dir"]) {
    const value = record[key];
    if (typeof value === "string") return value.replace(/^sections\//, "");
  }
  return null;
}

export function ToolCard({ tool }: { tool: ToolCallView }) {
  const path = subject(tool);
  const failed = tool.status === "error";

  return (
    <div className="flex items-center gap-2 py-[3px] text-ui-xs">
      <span className="flex size-3 shrink-0 items-center justify-center" aria-hidden>
        {tool.status === "running" ? (
          <span className="block size-2.5 animate-spin rounded-full border border-oe-border-strong border-t-oe-accent" />
        ) : failed ? (
          <X className="size-3 text-oe-bad" strokeWidth={2.2} />
        ) : (
          <Check className="size-3 text-oe-faint" strokeWidth={2.2} />
        )}
      </span>

      <span className={`shrink-0 ${failed ? "text-oe-bad" : "text-oe-muted"}`}>
        {LABELS[tool.name] ?? tool.name}
      </span>

      {path && (
        <span className="min-w-0 flex-1 truncate font-mono text-ui-2xs text-oe-faint">{path}</span>
      )}

      {failed && tool.summary && (
        <span className="min-w-0 flex-1 truncate text-right text-oe-bad">{tool.summary}</span>
      )}

      <span className="sr-only">
        {tool.status === "running" ? "running" : failed ? "failed" : "succeeded"}
        {tool.summary ? ` — ${tool.summary}` : ""}
      </span>
    </div>
  );
}
