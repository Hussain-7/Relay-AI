import { create } from "zustand";

import type {
  ConversationDetailDto,
  ConversationSummaryDto,
  ModelCatalogDto,
} from "@/lib/contracts";

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

interface ChatState {
  catalog: ModelCatalogDto | null;
  conversations: ConversationSummaryDto[];
  activeConversation: ConversationDetailDto | null;
  activeConversationId: string | null;

  /** Hydrate catalog + conversation list on mount */
  hydrate: () => Promise<void>;

  /** Select and load a conversation */
  selectConversation: (id: string) => Promise<void>;

  /** Optimistic create — adds to list instantly, creates in background */
  createConversation: () => Promise<void>;

  /** Optimistic delete — removes from list instantly, deletes in background */
  deleteConversation: (id: string) => Promise<void>;

  /** Update conversation title (from SSE event) */
  updateConversationTitle: (id: string, title: string) => void;

  /** Refresh a conversation detail + summary list after a run completes */
  refreshConversation: (id: string) => Promise<void>;

  /** Set the active conversation detail directly (for streaming updates) */
  setActiveConversation: (detail: ConversationDetailDto | null) => void;

  /** Update catalog */
  setCatalog: (catalog: ModelCatalogDto) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  catalog: null,
  conversations: [],
  activeConversation: null,
  activeConversationId: null,

  setCatalog: (catalog) => set({ catalog }),

  setActiveConversation: (detail) =>
    set({
      activeConversation: detail,
      activeConversationId: detail?.id ?? null,
    }),

  updateConversationTitle: (id, title) => {
    const { activeConversation, conversations } = get();

    set({
      conversations: conversations.map((c) =>
        c.id === id ? { ...c, title } : c,
      ),
      activeConversation:
        activeConversation?.id === id
          ? { ...activeConversation, title }
          : activeConversation,
    });
  },

  hydrate: async () => {
    const [catalogData, conversationsData] = await Promise.all([
      fetchJson<ModelCatalogDto>("/api/models"),
      fetchJson<{ conversations: ConversationSummaryDto[] }>(
        "/api/conversations",
      ),
    ]);

    set({ catalog: catalogData });

    if (conversationsData.conversations.length === 0) {
      // Auto-create first conversation
      const created = await fetchJson<{
        conversation: ConversationDetailDto;
      }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({}),
      });

      set({
        conversations: [toSummary(created.conversation)],
        activeConversation: created.conversation,
        activeConversationId: created.conversation.id,
      });
    } else {
      const list = conversationsData.conversations;
      const firstDetail = await fetchJson<{
        conversation: ConversationDetailDto;
      }>(`/api/conversations/${list[0]!.id}`);

      set({
        conversations: list,
        activeConversation: firstDetail.conversation,
        activeConversationId: firstDetail.conversation.id,
      });
    }
  },

  selectConversation: async (id) => {
    const { activeConversationId } = get();
    if (id === activeConversationId) return;

    // Optimistic: set active id immediately so sidebar highlights
    set({ activeConversationId: id });

    const data = await fetchJson<{
      conversation: ConversationDetailDto;
    }>(`/api/conversations/${id}`);

    set({
      activeConversation: data.conversation,
      activeConversationId: data.conversation.id,
    });
  },

  createConversation: async () => {
    // Optimistic placeholder
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const optimisticSummary: ConversationSummaryDto = {
      id: tempId,
      title: "New chat",
      defaultMode: "AGENT",
      createdAt: now,
      updatedAt: now,
      latestRunStatus: null,
      latestSnippet: null,
      codingStatus: null,
    };

    const prevConversations = get().conversations;

    set({
      conversations: [optimisticSummary, ...prevConversations],
      activeConversationId: tempId,
      activeConversation: null, // will be populated after API call
    });

    try {
      const data = await fetchJson<{
        conversation: ConversationDetailDto;
      }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({}),
      });

      set({
        // Replace temp entry with real one
        conversations: [
          toSummary(data.conversation),
          ...prevConversations,
        ],
        activeConversation: data.conversation,
        activeConversationId: data.conversation.id,
      });
    } catch {
      // Revert
      set({
        conversations: prevConversations,
        activeConversation: null,
        activeConversationId: prevConversations[0]?.id ?? null,
      });
      throw new Error("Failed to create a conversation.");
    }
  },

  deleteConversation: async (id) => {
    const {
      conversations: prevConversations,
      activeConversationId,
    } = get();
    const remaining = prevConversations.filter((c) => c.id !== id);
    const wasActive = activeConversationId === id;

    // Optimistic remove
    set({
      conversations: remaining,
      ...(wasActive
        ? {
            activeConversationId: remaining[0]?.id ?? null,
            activeConversation: null,
          }
        : {}),
    });

    try {
      await fetchJson(`/api/conversations/${id}`, { method: "DELETE" });

      // If we deleted the active one, load the next (or create new)
      if (wasActive) {
        if (remaining.length === 0) {
          await get().createConversation();
        } else {
          await get().selectConversation(remaining[0]!.id);
        }
      }
    } catch {
      // Revert
      set({
        conversations: prevConversations,
        ...(wasActive ? { activeConversationId: id } : {}),
      });
      throw new Error("Failed to delete the chat.");
    }
  },

  refreshConversation: async (id) => {
    const [detail, listData] = await Promise.all([
      fetchJson<{ conversation: ConversationDetailDto }>(
        `/api/conversations/${id}`,
      ),
      fetchJson<{ conversations: ConversationSummaryDto[] }>(
        "/api/conversations",
      ),
    ]);

    const { activeConversationId } = get();

    set({
      conversations: listData.conversations,
      ...(activeConversationId === id
        ? { activeConversation: detail.conversation }
        : {}),
    });
  },
}));
