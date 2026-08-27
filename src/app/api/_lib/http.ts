/**
 * Layer 1 plumbing shared by the route handlers: parse → validate → call a
 * service → shape the response. Handlers stay thin; nothing here knows what a
 * job or a section is.
 *
 * `_lib` is a private folder — Next never routes a directory prefixed with `_`.
 */
import { ZodError, type ZodType } from "zod";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function fail(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Parses and validates a JSON body, turning both failure modes into a 400. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError("body is not valid JSON", 400);
  }
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.join(".") ?? "body";
      throw new HttpError(`${where}: ${first?.message ?? "invalid"}`, 400);
    }
    throw err;
  }
}

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

/** Wraps a handler so a thrown HttpError becomes its status and anything else a 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error("[api] unhandled", err);
    const message = err instanceof Error ? err.message : "internal error";
    return fail(message, 500);
  }
}
