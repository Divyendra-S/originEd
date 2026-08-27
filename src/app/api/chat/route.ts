import { z } from "zod";
import * as chatService from "@/server/services/chat.service";
import { handle, json, parseBody } from "../_lib/http";

export const runtime = "nodejs";

/**
 * One pinned element. Everything here is describing a node that already exists
 * in the source the server is about to snapshot — no bytes, no source location,
 * and deliberately no `attrs`: the prompt never renders them, so accepting them
 * would only widen what an untrusted body can put in front of the model.
 */
const Target = z.object({
  sectionSlug: z.string().min(1).max(64),
  path: z.array(z.number().int().nonnegative().max(1000)).max(24),
  tag: z.string().max(24).default(""),
  text: z.string().max(200).default(""),
  label: z.string().max(120).default(""),
  trail: z.string().max(240).default(""),
  nth: z.number().int().nonnegative().max(1000).default(0),
});

const Body = z.object({
  chatId: z.uuid().nullish(),
  text: z.string().trim().min(1, "message is empty").max(4000),
  /**
   * Slugs and targets, not sources — the server snapshots the bytes itself (§5).
   * The bare-string arm is a whole-section pin, which is what every attachment
   * was before element selection and what every stored row still is.
   */
  attachments: z.array(z.union([z.string().min(1).max(64), Target])).max(12).default([]),
});

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await parseBody(request, Body);
    const result = await chatService.send({
      chatId: body.chatId ?? null,
      text: body.text,
      attachments: body.attachments,
    });
    // Returns as soon as the job is queued. The browser opens the SSE stream next.
    return json(result, 201);
  });
}
