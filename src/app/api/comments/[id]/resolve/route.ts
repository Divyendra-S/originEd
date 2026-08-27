import type { NextRequest } from "next/server";
import * as commentService from "@/server/services/comment.service";
import { handle, json } from "../../../_lib/http";

export const runtime = "nodejs";

/**
 * The user ticking a note off by hand. A job that answers a note resolves it
 * itself, from the ids frozen in its context (§11) — this is the other way.
 */
export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/comments/[id]/resolve">,
): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    await commentService.resolve(id);
    return json({ ok: true });
  });
}
