import { z } from "zod";
import * as commentService from "@/server/services/comment.service";
import { fail, handle, json, parseBody } from "../_lib/http";

export const runtime = "nodejs";

const Body = z.object({
  sectionSlug: z.string().min(1).max(64),
  body: z.string().trim().min(1, "note is empty").max(commentService.MAX_BODY),
});

/** Every open note, for every section. Small enough to be one query (§11). */
export async function GET(): Promise<Response> {
  return handle(async () => json(await commentService.list()));
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const input = await parseBody(request, Body);
    const comment = await commentService.add(input);
    // A note on a section that does not exist is the caller's mistake, not ours.
    return comment ? json(comment, 201) : fail("section not found", 404);
  });
}
