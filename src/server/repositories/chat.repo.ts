import type { Chat } from "@/lib/types";
import { db, unwrap, unwrapMaybe } from "./supabase";

type Row = { id: string; title: string | null; created_at: string };
const toChat = (r: Row): Chat => ({ id: r.id, title: r.title, createdAt: r.created_at });

export async function create(title: string | null = null): Promise<Chat> {
  const res = await db().from("chats").insert({ title }).select().single();
  return toChat(unwrap<Row>(res, "chat.create"));
}

export async function byId(id: string): Promise<Chat | null> {
  const res = await db().from("chats").select().eq("id", id).maybeSingle();
  const row = unwrapMaybe<Row>(res, "chat.byId");
  return row ? toChat(row) : null;
}

export async function listRecent(limit = 20): Promise<Chat[]> {
  const res = await db().from("chats").select().order("created_at", { ascending: false }).limit(limit);
  return unwrap<Row[]>(res, "chat.listRecent").map(toChat);
}

export async function setTitle(id: string, title: string): Promise<void> {
  const res = await db().from("chats").update({ title }).eq("id", id);
  if (res.error) throw new Error(`chat.setTitle: ${res.error.message}`);
}
