"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  ConversationDetailDto,
  ConversationSummaryDto,
  ModelCatalogDto,
} from "@/lib/contracts";
import { fetchJson } from "@/lib/chat-utils";

export const queryKeys = {
  models: ["models"] as const,
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversation", id] as const,
};

export function useModelCatalog() {
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: () => fetchJson<ModelCatalogDto>("/api/models"),
    staleTime: Infinity,
  });
}

export function useConversations() {
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: async () => {
      const data = await fetchJson<{ conversations: ConversationSummaryDto[] }>(
        "/api/conversations",
      );
      return data.conversations;
    },
    staleTime: 60 * 1000,
  });
}

export function useConversationDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.conversation(id ?? ""),
    queryFn: async () => {
      const data = await fetchJson<{ conversation: ConversationDetailDto }>(
        `/api/conversations/${id}`,
      );
      return data.conversation;
    },
    enabled: id !== null,
    staleTime: 30 * 1000,
  });
}

function toSummary(detail: ConversationDetailDto): ConversationSummaryDto {
  const latestRun = detail.runs.at(-1) ?? null;

  return {
    id: detail.id,
    title: detail.title,
    defaultMode: detail.defaultMode,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    latestRunStatus: latestRun?.status ?? null,
    latestSnippet: latestRun?.finalText ?? latestRun?.userPrompt ?? null,
    codingStatus: detail.codingSession?.status ?? null,
  };
}

export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars?: { id?: string }) => {
      const data = await fetchJson<{ conversation: ConversationDetailDto }>(
        "/api/conversations",
        { method: "POST", body: JSON.stringify({ id: vars?.id }) },
      );
      return data.conversation;
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations });
      const previous = queryClient.getQueryData<ConversationSummaryDto[]>(
        queryKeys.conversations,
      );

      const optimisticId = vars?.id ?? `temp-${Date.now()}`;
      const now = new Date().toISOString();
      const optimistic: ConversationSummaryDto = {
        id: optimisticId,
        title: "New chat",
        defaultMode: "AGENT",
        createdAt: now,
        updatedAt: now,
        latestRunStatus: null,
        latestSnippet: null,
        codingStatus: null,
      };

      queryClient.setQueryData<ConversationSummaryDto[]>(
        queryKeys.conversations,
        (old) => [optimistic, ...(old ?? [])],
      );

      return { previous, optimisticId };
    },
    onSuccess: (conversation, _vars, context) => {
      queryClient.setQueryData<ConversationSummaryDto[]>(
        queryKeys.conversations,
        (old) =>
          (old ?? []).map((c) =>
            c.id === context?.optimisticId ? toSummary(conversation) : c,
          ),
      );
      queryClient.setQueryData(
        queryKeys.conversation(conversation.id),
        conversation,
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.conversations, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await fetchJson(`/api/conversations/${id}`, { method: "DELETE" });
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations });
      const previous = queryClient.getQueryData<ConversationSummaryDto[]>(
        queryKeys.conversations,
      );

      queryClient.setQueryData<ConversationSummaryDto[]>(
        queryKeys.conversations,
        (old) => (old ?? []).filter((c) => c.id !== id),
      );

      return { previous };
    },
    onSuccess: (id) => {
      queryClient.removeQueries({ queryKey: queryKeys.conversation(id) });
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.conversations, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useUpdateConversationModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      model,
    }: {
      id: string;
      model: string;
    }) => {
      const data = await fetchJson<{ conversation: ConversationDetailDto }>(
        `/api/conversations/${id}`,
        { method: "PATCH", body: JSON.stringify({ mainAgentModel: model }) },
      );
      return data.conversation;
    },
    onMutate: async ({ id, model }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.conversation(id),
      });
      const previous = queryClient.getQueryData<ConversationDetailDto>(
        queryKeys.conversation(id),
      );

      if (previous) {
        queryClient.setQueryData<ConversationDetailDto>(
          queryKeys.conversation(id),
          { ...previous, mainAgentModel: model },
        );
      }

      return { previous };
    },
    onSuccess: (conversation) => {
      queryClient.setQueryData(
        queryKeys.conversation(conversation.id),
        conversation,
      );
    },
    onError: (_err, { id }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.conversation(id), context.previous);
      }
    },
    onSettled: (_data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) });
    },
  });
}
