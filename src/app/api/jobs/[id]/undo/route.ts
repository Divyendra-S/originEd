import type { NextRequest } from "next/server";
import * as diffService from "@/server/services/diff.service";
import { HttpError, handle, json } from "../../../_lib/http";

export const runtime = "nodejs";

/** Replays the job's writes backwards (§12). Returns the diff, now marked reverted. */
export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/undo">,
): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    try {
      return json(await diffService.restore(id));
    } catch (err) {
      // A refusal, not a fault: the user asked for something we can still explain.
      if (err instanceof diffService.RestoreConflict) throw new HttpError(err.message, 409);
      throw err;
    }
  });
}
