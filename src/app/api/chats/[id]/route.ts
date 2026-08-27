import type { NextRequest } from "next/server";
import * as chatService from "@/server/services/chat.service";
import { fail, handle, json } from "../../_lib/http";

export const runtime = "nodejs";

/** The transcript snapshot. TanStack Query owns this; the stream does not (§13). */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/chats/[id]">,
): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const transcript = await chatService.transcript(id);
    return transcript ? json(transcript) : fail("chat not found", 404);
  });
}
