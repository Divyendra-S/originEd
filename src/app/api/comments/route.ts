import { z } from "zod";
import * as commentService from "@/server/services/comment.service";
import { fail, handle, json, parseBody } from "../_lib/http";

export const runtime = "nodejs";

/**
 * The element a note is on. Same shape as the chat route's pinned target, and
 * `attrs` is left out for the same reason: nothing downstream renders it, so
 * accepting it would only widen what an untrusted body can store.
 */
const Ref = z.object({
  sectionSlug: z.string().min(1).max(64),
  path: z.array(z.number().int().nonnegative().max(1000)).max(24),
  tag: z.string().max(24).default(""),
  text: z.string().max(200).default(""),
  label: z.string().max(120).default(""),
  trail: z.string().max(240).default(""),
  nth: z.number().int().nonnegative().max(1000).default(0),
});

const Body = z
  .object({
    sectionSlug: z.string().min(1).max(64),
    body: z.string().trim().min(1, "note is empty").max(commentService.MAX_BODY),
    /** Absent for a note on the whole section — which is every note until now. */
    target: z
      .object({ key: z.string().min(1).max(200), label: z.string().max(120).default(""), ref: Ref })
      .optional(),
  })
  // The note is filed under `section_slug` and described by `target_label`, and
  // a target pointing at a different section than the one it is filed under
  // would put the note on the wrong side of every lookup that follows. The
  // client always has both, so a mismatch is a bug, not a case to reconcile.
  .refine((v) => !v.target || v.target.ref.sectionSlug === v.sectionSlug, {
    path: ["target"],
    message: "target belongs to a different section",
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
