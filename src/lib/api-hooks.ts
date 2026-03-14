"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  ConversationDetailDto,
  ConversationSummaryDto,
  ModelCatalogDto,
} from "@/lib/contracts";
import { fetchJson } from "@/lib/chat-utils";

export const queryKeys = {
  user: ["user"] as const,
  models: ["models"] as const,
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversation", id] as const,
  githubStatus: ["github-status"] as const,
  preferences: ["preferences"] as const,
  mcpConnectors: ["mcp-connectors"] as const,
  repoBindings: ["repo-bindings"] as const,
};

export interface AuthUser {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export function useUser() {
  return useQuery({
    queryKey: queryKeys.user,
    queryFn: async () => {
      const data = await fetchJson<{ user: AuthUser | null }>("/api/user");
      return data.user;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useModelCatalog() {
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: () => fetchJson<ModelCatalogDto>("/api/models"),
    staleTime: Infinity,
  });
}

export interface UserPreferences {
  agent: {
    model: string;
    thinking: boolean;
    effort: "low" | "medium" | "high";
    memory: boolean;
  };
}

const defaultPreferences: UserPreferences = {
  agent: { model: "claude-sonnet-4-6", thinking: true, effort: "high", memory: false },
};

export function usePreferences() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.preferences,
    queryFn: async () => {
      const data = await fetchJson<{ preferences: UserPreferences }>("/api/preferences");
      return data.preferences;
    },
    staleTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: async (prefs: Partial<UserPreferences>) => {
      const data = await fetchJson<{ preferences: UserPreferences }>("/api/preferences", {
        method: "PATCH",
        body: JSON.stringify(prefs),
      });
      return data.preferences;
    },
    onSuccess: (prefs) => {
      queryClient.setQueryData(queryKeys.preferences, prefs);
    },
  });

  return {
    preferences: query.data ?? defaultPreferences,
    isLoading: query.isLoading,
    savePreferences: mutation.mutate,
  };
}

export function useGithubStatus() {
  return useQuery({
    queryKey: queryKeys.githubStatus,
    queryFn: () =>
      fetchJson<{ configured: boolean; installed: boolean; installUrl?: string }>(
        "/api/github/status",
      ),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useDisconnectGithub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await fetchJson("/api/github/status", { method: "DELETE" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubStatus });
    },
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
    repoFullName: detail.repoBinding?.repoFullName ?? null,
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
        repoFullName: null,
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

// ─── MCP Connectors ────────────────────────────────────────────────────────────

export interface McpConnectorDto {
  id: string;
  name: string;
  url: string;
  hasToken: boolean;
  status: "ACTIVE" | "NEEDS_AUTH" | "ERROR" | "DISABLED";
  lastError: string | null;
  createdAt: string;
}

export function useMcpConnectors() {
  return useQuery({
    queryKey: queryKeys.mcpConnectors,
    queryFn: async () => {
      const data = await fetchJson<{ connectors: McpConnectorDto[] }>("/api/mcp-connectors");
      return data.connectors;
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateMcpConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { name: string; url: string; authorizationToken?: string }) => {
      const data = await fetchJson<{
        connector: McpConnectorDto;
        needsAuth?: boolean;
      }>("/api/mcp-connectors", {
        method: "POST",
        body: JSON.stringify(vars),
      });
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors });
    },
  });
}

export function useDeleteMcpConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await fetchJson(`/api/mcp-connectors/${id}`, { method: "DELETE" });
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.mcpConnectors });
      const previous = queryClient.getQueryData<McpConnectorDto[]>(queryKeys.mcpConnectors);
      queryClient.setQueryData<McpConnectorDto[]>(
        queryKeys.mcpConnectors,
        (old) => (old ?? []).filter((c) => c.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.mcpConnectors, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors });
    },
  });
}

export function useToggleMcpConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const data = await fetchJson<{ connector: McpConnectorDto }>(
        `/api/mcp-connectors/${id}`,
        { method: "PATCH", body: JSON.stringify({ enabled }) },
      );
      return data.connector;
    },
    onSuccess: (connector) => {
      queryClient.setQueryData<McpConnectorDto[]>(
        queryKeys.mcpConnectors,
        (old) => (old ?? []).map((c) => (c.id === connector.id ? connector : c)),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors });
    },
  });
}

export function useTestMcpConnection() {
  return useMutation({
    mutationFn: async (vars: { url: string; authorizationToken?: string }) => {
      return fetchJson<{
        success: boolean;
        needsAuth: boolean;
        error?: string;
        serverName?: string;
      }>("/api/mcp-connectors/test", {
        method: "POST",
        body: JSON.stringify(vars),
      });
    },
  });
}

// ─── Repo Bindings ──────────────────────────────────────────────────────────

export interface RepoBindingListItem {
  id: string;
  repoFullName: string;
  defaultBranch: string | null;
  installationId: string | null;
  metadataJson: Record<string, unknown> | null;
}

export interface GithubRepoSearchResult {
  fullName: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
  description: string | null;
}

export function useRepoBindings() {
  return useQuery({
    queryKey: queryKeys.repoBindings,
    queryFn: async () => {
      const data = await fetchJson<{ bindings: RepoBindingListItem[] }>("/api/repo-bindings");
      return data.bindings;
    },
    staleTime: 60 * 1000,
  });
}

export function useSearchGithubRepos() {
  return useMutation({
    mutationFn: async (query: string) => {
      const data = await fetchJson<{ repos: GithubRepoSearchResult[] }>(
        "/api/repo-bindings/search",
        { method: "POST", body: JSON.stringify({ query }) },
      );
      return data.repos;
    },
  });
}

export function useConnectRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (repoFullName: string) => {
      const data = await fetchJson<{ binding: RepoBindingListItem }>(
        "/api/repo-bindings/connect",
        { method: "POST", body: JSON.stringify({ repoFullName }) },
      );
      return data.binding;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repoBindings });
    },
  });
}

export function useDeleteRepoBinding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await fetchJson(`/api/repo-bindings/${id}`, { method: "DELETE" });
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.repoBindings });
      const previous = queryClient.getQueryData<RepoBindingListItem[]>(queryKeys.repoBindings);
      queryClient.setQueryData<RepoBindingListItem[]>(
        queryKeys.repoBindings,
        (old) => (old ?? []).filter((b) => b.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.repoBindings, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repoBindings });
    },
  });
}

export function useLinkRepoToConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, repoBindingId }: { conversationId: string; repoBindingId: string | null }) => {
      const data = await fetchJson<{ conversation: ConversationDetailDto }>(
        `/api/conversations/${conversationId}`,
        { method: "PATCH", body: JSON.stringify({ repoBindingId }) },
      );
      return data.conversation;
    },
    onSuccess: (conversation) => {
      queryClient.setQueryData(
        queryKeys.conversation(conversation.id),
        conversation,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}
