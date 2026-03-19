"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  ConversationDetailDto,
  ConversationSummaryDto,
  ModelCatalogDto,
} from "@/lib/contracts";
import { api } from "@/lib/api-client";

export const queryKeys = {
  user: ["user"] as const,
  models: ["models"] as const,
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversation", id] as const,
  githubStatus: ["github-status"] as const,
  preferences: ["preferences"] as const,
  mcpConnectors: ["mcp-connectors"] as const,
  repoBindings: ["repo-bindings"] as const,
  repoSecrets: (repoBindingId: string) => ["repo-secrets", repoBindingId] as const,
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
      const data = await api.get<{ user: AuthUser | null }>("/api/user");
      return data.user;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useModelCatalog() {
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: () => api.get<ModelCatalogDto>("/api/models"),
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
  agent: { model: "claude-sonnet-4-6", thinking: false, effort: "low", memory: false },
};

export function usePreferences() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.preferences,
    queryFn: async () => {
      const data = await api.get<{ preferences: UserPreferences }>("/api/preferences");
      return data.preferences;
    },
    staleTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: async (prefs: Partial<UserPreferences>) => {
      const data = await api.patch<{ preferences: UserPreferences }>("/api/preferences", prefs);
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
      api.get<{ configured: boolean; installed: boolean; installUrl?: string }>(
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
      await api.del("/api/github/status");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.repoBindings });
    },
  });
}

export function useConversations() {
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: async () => {
      const data = await api.get<{ conversations: ConversationSummaryDto[] }>(
        "/api/conversations",
      );
      return data.conversations;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useConversationDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.conversation(id ?? ""),
    queryFn: async () => {
      const data = await api.get<{ conversation: ConversationDetailDto }>(
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
    isStarred: detail.isStarred,
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
      const data = await api.post<{ conversation: ConversationDetailDto }>(
        "/api/conversations",
        { id: vars?.id },
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
        isStarred: false,
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
      await api.del(`/api/conversations/${id}`);
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

export function useToggleConversationStar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, isStarred }: { id: string; isStarred: boolean }) => {
      const data = await api.patch<{ conversation: ConversationDetailDto }>(
        `/api/conversations/${id}`,
        { isStarred },
      );
      return data.conversation;
    },
    onMutate: async ({ id, isStarred }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations });
      const previousList = queryClient.getQueryData<ConversationSummaryDto[]>(queryKeys.conversations);

      queryClient.setQueryData<ConversationSummaryDto[]>(
        queryKeys.conversations,
        (old) => {
          const now = new Date().toISOString();
          const updated = (old ?? []).map((c) => (c.id === id ? { ...c, isStarred, updatedAt: now } : c));
          return updated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        },
      );
      return { previousList };
    },
    onSuccess: (conversation, { id }) => {
      // Apply server truth to both caches so subsequent refetches don't flash
      queryClient.setQueryData<ConversationSummaryDto[]>(
        queryKeys.conversations,
        (old) => (old ?? []).map((c) => (c.id === id ? { ...c, isStarred: conversation.isStarred } : c)),
      );
      queryClient.setQueryData<ConversationDetailDto>(
        queryKeys.conversation(id),
        (old) => old ? { ...old, isStarred: conversation.isStarred } : old,
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(queryKeys.conversations, context.previousList);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const data = await api.patch<{ conversation: ConversationDetailDto }>(
        `/api/conversations/${id}`,
        { title },
      );
      return data.conversation;
    },
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations });
      const previousList = queryClient.getQueryData<ConversationSummaryDto[]>(queryKeys.conversations);
      const previousDetail = queryClient.getQueryData<ConversationDetailDto>(queryKeys.conversation(id));

      // Optimistic update in list
      queryClient.setQueryData<ConversationSummaryDto[]>(
        queryKeys.conversations,
        (old) => (old ?? []).map((c) => (c.id === id ? { ...c, title } : c)),
      );
      // Optimistic update in detail
      if (previousDetail) {
        queryClient.setQueryData<ConversationDetailDto>(
          queryKeys.conversation(id),
          { ...previousDetail, title },
        );
      }
      return { previousList, previousDetail };
    },
    onError: (_err, { id }, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(queryKeys.conversations, context.previousList);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(queryKeys.conversation(id), context.previousDetail);
      }
    },
    onSettled: (_data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) });
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
      const data = await api.patch<{ conversation: ConversationDetailDto }>(
        `/api/conversations/${id}`,
        { mainAgentModel: model },
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
      const data = await api.get<{ connectors: McpConnectorDto[] }>("/api/mcp-connectors");
      return data.connectors;
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateMcpConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { name: string; url: string; authorizationToken?: string; clientId?: string }) => {
      const data = await api.post<{
        connector: McpConnectorDto;
        needsAuth?: boolean;
      }>("/api/mcp-connectors", vars);
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
      await api.del(`/api/mcp-connectors/${id}`);
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
      const data = await api.patch<{ connector: McpConnectorDto }>(
        `/api/mcp-connectors/${id}`,
        { enabled },
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
      return api.post<{
        success: boolean;
        needsAuth: boolean;
        error?: string;
        serverName?: string;
      }>("/api/mcp-connectors/test", vars);
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
  owner: string;
  defaultBranch: string;
  isPrivate: boolean;
  description: string | null;
  updatedAt: string;
}

export interface RepoBindingsData {
  bindings: RepoBindingListItem[];
  available: GithubRepoSearchResult[];
  owners: string[];
}

export function useRepoBindings() {
  return useQuery({
    queryKey: queryKeys.repoBindings,
    queryFn: async () => {
      const data = await api.get<RepoBindingsData>("/api/repo-bindings");
      return data;
    },
    staleTime: 30 * 60 * 1000, // 30 min — backed by server-side Redis cache
  });
}

export function useRefreshRepoBindings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const data = await api.get<RepoBindingsData>("/api/repo-bindings?refresh=true");
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.repoBindings, data);
      // Invalidate all per-owner caches so they re-fetch
      void queryClient.invalidateQueries({ queryKey: ["repo-bindings", "owner"] });
    },
  });
}

export function useOwnerRepos(owner: string | null) {
  return useQuery({
    queryKey: ["repo-bindings", "owner", owner] as const,
    queryFn: async () => {
      const data = await api.get<{ repos: GithubRepoSearchResult[] }>(
        `/api/repo-bindings?owner=${encodeURIComponent(owner!)}`,
      );
      return data.repos;
    },
    enabled: owner !== null,
    staleTime: 30 * 60 * 1000,
  });
}

export function useSearchGithubRepos() {
  return useMutation({
    mutationFn: async (query: string) => {
      const data = await api.post<{ repos: GithubRepoSearchResult[] }>(
        "/api/repo-bindings/search",
        { query },
      );
      return data.repos;
    },
  });
}

export function useConnectRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (repoFullName: string) => {
      const data = await api.post<{ binding: RepoBindingListItem }>(
        "/api/repo-bindings/connect",
        { repoFullName },
      );
      return data.binding;
    },
    onMutate: async (repoFullName) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.repoBindings });
      const previous = queryClient.getQueryData<RepoBindingsData>(queryKeys.repoBindings);

      // Optimistic: add to bindings immediately
      const optimisticBinding: RepoBindingListItem = {
        id: `temp-${Date.now()}`,
        repoFullName,
        defaultBranch: "main",
        installationId: null,
        metadataJson: null,
      };
      queryClient.setQueryData<RepoBindingsData>(
        queryKeys.repoBindings,
        (old) => ({
          bindings: [optimisticBinding, ...(old?.bindings ?? [])],
          available: old?.available ?? [],
          owners: old?.owners ?? [],
        }),
      );
      return { previous, optimisticId: optimisticBinding.id };
    },
    onSuccess: (binding, _vars, context) => {
      // Replace optimistic with real binding
      queryClient.setQueryData<RepoBindingsData>(
        queryKeys.repoBindings,
        (old) => ({
          bindings: (old?.bindings ?? []).map((b) => b.id === context?.optimisticId ? binding : b),
          available: old?.available ?? [],
          owners: old?.owners ?? [],
        }),
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.repoBindings, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repoBindings });
    },
  });
}

export function useDeleteRepoBinding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.del(`/api/repo-bindings/${id}`);
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.repoBindings });
      const previous = queryClient.getQueryData<RepoBindingsData>(queryKeys.repoBindings);
      queryClient.setQueryData<RepoBindingsData>(
        queryKeys.repoBindings,
        (old) => ({
          bindings: (old?.bindings ?? []).filter((b) => b.id !== id),
          available: old?.available ?? [],
          owners: old?.owners ?? [],
        }),
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
      const data = await api.patch<{ conversation: ConversationDetailDto }>(
        `/api/conversations/${conversationId}`,
        { repoBindingId },
      );
      return data.conversation;
    },
    // Optimistic: update conversation detail immediately
    onMutate: async ({ conversationId, repoBindingId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversation(conversationId) });
      const previous = queryClient.getQueryData<ConversationDetailDto>(queryKeys.conversation(conversationId));

      if (previous) {
        const repoData = queryClient.getQueryData<RepoBindingsData>(queryKeys.repoBindings);
        const matchingBinding = repoData?.bindings.find((b) => b.id === repoBindingId);

        queryClient.setQueryData<ConversationDetailDto>(
          queryKeys.conversation(conversationId),
          {
            ...previous,
            repoBinding: repoBindingId && matchingBinding
              ? {
                  id: matchingBinding.id,
                  provider: "GITHUB",
                  repoOwner: matchingBinding.repoFullName.split("/")[0],
                  repoName: matchingBinding.repoFullName.split("/")[1],
                  repoFullName: matchingBinding.repoFullName,
                  defaultBranch: matchingBinding.defaultBranch,
                  installationId: matchingBinding.installationId,
                  metadataJson: null,
                }
              : null,
          },
        );
      }
      return { previous };
    },
    onSuccess: (conversation) => {
      queryClient.setQueryData(
        queryKeys.conversation(conversation.id),
        conversation,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
    onError: (_err, { conversationId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.conversation(conversationId), context.previous);
      }
    },
  });
}

// ─── Repo Secrets ────────────────────────────────────────────────────────────

export interface RepoSecretDto {
  id: string;
  key: string;
  hasValue: boolean;
  updatedAt: string;
}

export function useRepoSecrets(repoBindingId: string | null) {
  return useQuery({
    queryKey: queryKeys.repoSecrets(repoBindingId ?? ""),
    queryFn: async () => {
      const data = await api.get<{ secrets: RepoSecretDto[] }>(
        `/api/repo-bindings/${repoBindingId}/secrets`,
      );
      return data.secrets;
    },
    enabled: repoBindingId !== null,
    staleTime: 60 * 1000,
  });
}

export function useSaveRepoSecrets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      repoBindingId,
      secrets,
    }: {
      repoBindingId: string;
      secrets: { key: string; value: string }[];
    }) => {
      const data = await api.put<{ secrets: RepoSecretDto[] }>(
        `/api/repo-bindings/${repoBindingId}/secrets`,
        { secrets },
      );
      return data.secrets;
    },
    onSuccess: (secrets, { repoBindingId }) => {
      queryClient.setQueryData(queryKeys.repoSecrets(repoBindingId), secrets);
    },
  });
}

export function useDeleteRepoSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      repoBindingId,
      secretId,
    }: {
      repoBindingId: string;
      secretId: string;
    }) => {
      await api.del(`/api/repo-bindings/${repoBindingId}/secrets/${secretId}`);
      return { repoBindingId, secretId };
    },
    onMutate: async ({ repoBindingId, secretId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.repoSecrets(repoBindingId) });
      const previous = queryClient.getQueryData<RepoSecretDto[]>(queryKeys.repoSecrets(repoBindingId));
      queryClient.setQueryData<RepoSecretDto[]>(
        queryKeys.repoSecrets(repoBindingId),
        (old) => (old ?? []).filter((s) => s.id !== secretId),
      );
      return { previous };
    },
    onError: (_err, { repoBindingId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.repoSecrets(repoBindingId), context.previous);
      }
    },
    onSettled: (_data, _err, { repoBindingId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repoSecrets(repoBindingId) });
    },
  });
}
