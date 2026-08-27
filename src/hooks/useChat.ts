"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Attachment, Chat, JobChanges, Message } from "@/lib/types";

export interface TranscriptResponse {
  chat: Chat;
  messages: Message[];
  /** §12 level 2, keyed by job — what each turn changed, without the file bodies. */
  changes: JobChanges[];
}

/** The durable transcript. Live deltas come from useJobStream, not from here (§13). */
export function useChat(chatId: string | null) {
  return useQuery({
    queryKey: ["chat", chatId],
    queryFn: () => api.get<TranscriptResponse>(`/api/chats/${chatId}`),
    enabled: Boolean(chatId),
  });
}

export interface SendVariables {
  chatId: string | null;
  text: string;
  attachments: Attachment[];
}

export interface SendResponse {
  chatId: string;
  jobId: string;
  messageId: string;
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: SendVariables) => api.post<SendResponse>("/api/chat", variables),
    onSuccess: (data) => {
      // The user turn is already in Postgres; pull it in so the optimistic and
      // the persisted transcript agree before the model starts streaming.
      void queryClient.invalidateQueries({ queryKey: ["chat", data.chatId] });
    },
  });
}
