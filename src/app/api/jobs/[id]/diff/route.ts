import type { NextRequest } from "next/server";
import * as diffService from "@/server/services/diff.service";
import { handle, json } from "../../../_lib/http";

export const runtime = "nodejs";

/**
 * Level 3 of §12. Fetched lazily — the ChangeCard already knows what changed
 * from the transcript, so nobody pays for hunks until they click Review.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/diff">,
): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    return json(await diffService.forJob(id));
  });
}
