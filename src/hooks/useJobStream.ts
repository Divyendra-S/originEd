"use client";

/**
 * The push half of §13. TanStack Query owns snapshots; this owns everything that
 * is true only while a job is in flight, in a local reducer. Do not model the
 * stream as a query — it is a channel, not a fetch, and mixing the two is the
 * usual failure mode here.
 *
 * On `done` the reducer stops being the source of truth: the caller invalidates
 * `['chat', chatId]`, the transcript refetches from Postgres, and this state is
 * dropped. That handoff is a single moment, not a merge.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { FileOp, JobEventData, JobEventType, JobStatus } from "@/lib/types";

export interface ToolCallView {
  id: string;
  name: string;
  args: unknown;
  status: "running" | "ok" | "error";
  summary: string | null;
}

export interface FileChangeView {
  path: string;
  op: FileOp;
  sectionSlug: string | null;
}

export interface JobStreamState {
  jobId: string | null;
  status: JobStatus | null;
  text: string;
  tools: ToolCallView[];
  files: FileChangeView[];
  usage: { promptTokenCount: number; candidatesTokenCount: number } | null;
  error: string | null;
  done: boolean;
  /** False while EventSource is between retries — the strip shows "reconnecting". */
  connected: boolean;
  /**
   * Tool calls from jobs that already finished this session, by job id.
   * Postgres keeps the model's text but not its calls, so a finished turn would
   * lose its ToolCards the moment the next job resets the reducer. Carrying them
   * here keeps the transcript honest until a reload.
   */
  history: Record<string, ToolCallView[]>;
}

export const emptyStream: JobStreamState = {
  jobId: null,
  status: null,
  text: "",
  tools: [],
  files: [],
  usage: null,
  error: null,
  done: false,
  connected: false,
  history: {},
};

/** Folds the outgoing job's tool calls into the history map. */
function archive(state: JobStreamState): Record<string, ToolCallView[]> {
  if (!state.jobId || state.tools.length === 0) return state.history;
  return { ...state.history, [state.jobId]: state.tools };
}

type Action =
  | { kind: "reset"; jobId: string }
  | { kind: "clear" }
  | { kind: "open" }
  | { kind: "drop" }
  | { kind: "event"; data: JobEventData };

export function jobStreamReducer(state: JobStreamState, action: Action): JobStreamState {
  switch (action.kind) {
    case "reset":
      return { ...emptyStream, jobId: action.jobId, history: archive(state) };
    case "clear":
      return state.jobId === null ? state : { ...emptyStream, history: archive(state) };
    case "open":
      return { ...state, connected: true };
    case "drop":
      return state.done ? state : { ...state, connected: false };
    case "event":
      break;
  }

  const event = action.data;
  switch (event.type) {
    case "status":
      return { ...state, status: event.status };
    case "text_delta":
      return { ...state, text: state.text + event.text };
    case "tool_call":
      // Replay can redeliver a call we already have; keep it idempotent.
      if (state.tools.some((t) => t.id === event.id)) return state;
      return {
        ...state,
        tools: [
          ...state.tools,
          { id: event.id, name: event.name, args: event.args, status: "running", summary: null },
        ],
      };
    case "tool_result":
      return {
        ...state,
        tools: state.tools.map((t) =>
          t.id === event.id
            ? { ...t, status: event.ok ? "ok" : "error", summary: event.summary }
            : t,
        ),
      };
    case "file_changed":
      if (state.files.some((f) => f.path === event.path)) return state;
      return {
        ...state,
        files: [...state.files, { path: event.path, op: event.op, sectionSlug: event.sectionSlug }],
      };
    case "usage":
      return {
        ...state,
        usage: {
          promptTokenCount: event.promptTokenCount,
          candidatesTokenCount: event.candidatesTokenCount,
        },
      };
    case "error":
      return { ...state, error: event.message };
    case "done":
      return { ...state, status: event.status, done: true, connected: false };
  }
}

const EVENT_TYPES: JobEventType[] = [
  "status",
  "text_delta",
  "tool_call",
  "tool_result",
  "file_changed",
  "usage",
  "error",
  "done",
];

export interface JobStreamHandlers {
  onDone?: (event: Extract<JobEventData, { type: "done" }>) => void;
  onFileChanged?: (event: Extract<JobEventData, { type: "file_changed" }>) => void;
}

export function useJobStream(jobId: string | null, handlers: JobStreamHandlers = {}): JobStreamState {
  const [state, dispatch] = useReducer(jobStreamReducer, emptyStream);

  // Held in a ref so a caller passing inline closures does not tear down and
  // reopen the connection on every render. Assigned in an effect, never during
  // render — the connection is opened by an effect too, so it is never stale.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!jobId) {
      dispatch({ kind: "clear" });
      return;
    }
    dispatch({ kind: "reset", jobId });

    const source = new EventSource(`/api/jobs/${jobId}/stream`);
    let finished = false;

    function onEvent(raw: MessageEvent<string>) {
      let data: JobEventData;
      try {
        data = JSON.parse(raw.data) as JobEventData;
      } catch {
        return;
      }
      dispatch({ kind: "event", data });

      if (data.type === "file_changed") handlersRef.current.onFileChanged?.(data);
      if (data.type === "done") {
        finished = true;
        source.close();
        handlersRef.current.onDone?.(data);
      }
    }

    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);
    source.onopen = () => dispatch({ kind: "open" });
    source.onerror = () => {
      // EventSource retries on its own and sends Last-Event-ID, which the route
      // replays from — so this is "reconnecting", not "failed".
      if (!finished) dispatch({ kind: "drop" });
    };

    return () => {
      finished = true;
      source.close();
    };
  }, [jobId]);

  return state;
}

/** Cancels a running job. The stream will deliver `done` with status cancelled. */
export function useCancelJob() {
  return useCallback(async (jobId: string) => {
    await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
  }, []);
}
