/**
 * §5, step 2. The whole point of this function is the ORDER of the four writes:
 * the attachment snapshot is taken and frozen into the job BEFORE anything runs,
 * so the context is the bytes the user was looking at when they hit send.
 */
import type { Attachment, Chat, JobChanges, Message } from "@/lib/types";
import * as chatRepo from "@/server/repositories/chat.repo";
import * as messageRepo from "@/server/repositories/message.repo";
import * as jobRepo from "@/server/repositories/job.repo";
import * as diffService from "./diff.service";
import * as jobService from "./job.service";
import * as sectionService from "./section.service";

export interface SendInput {
  chatId?: string | null;
  text: string;
  /** What is pinned in the composer: section slugs, and/or elements inside them. */
  attachments?: Attachment[];
}

export interface SendResult {
  chatId: string;
  jobId: string;
  messageId: string;
}

function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

export async function send(input: SendInput): Promise<SendResult> {
  const text = input.text.trim();
  if (!text) throw new Error("message text is empty");

  const chat = input.chatId
    ? await chatRepo.byId(input.chatId)
    : await chatRepo.create(titleFrom(text));
  if (!chat) throw new Error("chat not found");

  // VERBATIM, now — see section.service.snapshot.
  const attachments = await sectionService.snapshot(input.attachments ?? []);

  // The job is inserted before the message so the user turn can carry `job_id`
  // on the way in. §5 lists these the other way round, which would need a
  // follow-up UPDATE to link them; the frozen-context guarantee is unaffected.
  const job = await jobRepo.insert({
    chatId: chat.id,
    prompt: text,
    context: { attachments },
  });

  const message = await messageRepo.insert({
    chatId: chat.id,
    role: "user",
    content: { text, attachments },
    jobId: job.id,
  });

  // Queued, not awaited: the route returns ids and the browser opens the stream.
  jobService.start(job.id);

  return { chatId: chat.id, jobId: job.id, messageId: message.id };
}

export interface Transcript {
  chat: Chat;
  messages: Message[];
  /** §12 level 2, one entry per job that wrote something. Bodies excluded. */
  changes: JobChanges[];
}

/**
 * The transcript carries its own change summaries. The alternative — a
 * ChangeCard that fetches per turn — is one request per model message on every
 * chat load, to render a filename we could have sent with the message.
 */
export async function transcript(chatId: string): Promise<Transcript | null> {
  const chat = await chatRepo.byId(chatId);
  if (!chat) return null;

  const messages = await messageRepo.listByChat(chatId);
  const jobIds = [...new Set(messages.map((m) => m.jobId).filter((id): id is string => id !== null))];

  return { chat, messages, changes: await diffService.summarize(jobIds) };
}
