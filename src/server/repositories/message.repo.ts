import type { Message, MessageContent, MessageRole } from "@/lib/types";
import { db, unwrap } from "./supabase";

type Row = {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: MessageContent;
  job_id: string | null;
  created_at: string;
};

const toMessage = (r: Row): Message => ({
  id: r.id,
  chatId: r.chat_id,
  role: r.role,
  content: r.content,
  jobId: r.job_id,
  createdAt: r.created_at,
});

export async function insert(input: {
  chatId: string;
  role: MessageRole;
  content: MessageContent;
  jobId?: string | null;
}): Promise<Message> {
  const res = await db()
    .from("messages")
    .insert({
      chat_id: input.chatId,
      role: input.role,
      content: input.content,
      job_id: input.jobId ?? null,
    })
    .select()
    .single();
  return toMessage(unwrap<Row>(res, "message.insert"));
}

export async function listByChat(chatId: string): Promise<Message[]> {
  const res = await db()
    .from("messages")
    .select()
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  return unwrap<Row[]>(res, "message.listByChat").map(toMessage);
}
