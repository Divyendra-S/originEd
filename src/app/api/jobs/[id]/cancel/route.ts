import type { NextRequest } from "next/server";
import * as jobService from "@/server/services/job.service";
import { handle, json } from "../../../_lib/http";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/jobs/[id]/cancel">,
): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    return json(await jobService.cancel(id));
  });
}
