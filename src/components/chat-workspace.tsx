"use client";

import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type AgentPreferences, ComposerModelMenuPortal } from "@/components/chat/composer-model-menu";
import { ComposerPlusMenuPortal } from "@/components/chat/composer-plus-menu";
import { RenameModal } from "@/components/chat/rename-modal";
import { SidebarMenuPortal } from "@/components/chat/sidebar-menu-portal";
import {
  IconArrowUp,
  IconChevron,
  IconClose,
  IconGithub,
  IconKey,
  IconMore,
  IconPlus,
  IconSearch,
  IconSidebarToggle,
  IconSpark,
} from "@/components/icons";
import { api } from "@/lib/api-client";
import {
  queryKeys,
  useConversationDetail,
  useConversations,
  useDeleteConversation,
  useDisconnectGithub,
  useGithubStatus,
  useMcpConnectors,
  useModelCatalog,
  usePreferences,
  useRenameConversation,
  useToggleConversationStar,
  useUpdateConversationModel,
  useUser,
} from "@/lib/api-hooks";
import { formatModelDisplayName, formatRelativeDate, previewText, resizeComposer } from "@/lib/chat-utils";
import type { ConversationDetailDto } from "@/lib/contracts";

const McpConnectorModal = dynamic(
  () => import("@/components/chat/mcp-connector-modal").then((m) => ({ default: m.McpConnectorModal })),
  { ssr: false },
);
const RepoBindingModal = dynamic(
  () => import("@/components/chat/repo-binding-modal").then((m) => ({ default: m.RepoBindingModal })),
  { ssr: false },
);
const RepoSecretsModal = dynamic(
  () => import("@/components/chat/repo-secrets-modal").then((m) => ({ default: m.RepoSecretsModal })),
  { ssr: false },
);

import { AttachmentChip } from "@/components/chat/attachment-chip";
import { RunThread } from "@/components/chat/run-thread";
import { useAgentStream } from "@/hooks/useAgentStream";
import { useComposerState } from "@/hooks/useComposerState";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useModalState } from "@/hooks/useModalState";
import { usePendingMessage } from "@/hooks/usePendingMessage";
import { useScrollManager } from "@/hooks/useScrollManager";
import { peekPendingMessage, setPendingMessage } from "@/lib/pending-message";

export function ChatWorkspace({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const activeConversationId = conversationId ?? null;
  const navigateTo = useCallback(
    (id: string | null) => {
      if (id) {
        router.push(`/chat/${id}`);
      } else {
        router.push("/chat/new");
      }
    },
    [router],
  );

  const { preferences: userPreferences, savePreferences } = usePreferences();
  const agentPreferences: AgentPreferences = {
    thinking: userPreferences.agent.thinking,
    effort: userPreferences.agent.effort,
    memory: userPreferences.agent.memory,
  };

  const {
    liveRun,
    setLiveRun,
    liveRunRef,
    streamStartedForRef,
    previewUrlMapRef,
    errorMessage,
    setErrorMessage,
    isSending,
    setIsSending,
    startStream,
    handleStop,
    linkRepoMutation,
  } = useAgentStream({ agentPreferences });

  // Suppress detail fetch only for genuinely new conversations that haven't been created yet.
  // If cached data exists (existing conversation), keep the query active so previous runs
  // remain visible while a new liveRun streams. The liveRunRef bridges the gap between
  // pending-message consumption and createMutation resolution for new conversations.
  const cachedDetail = activeConversationId
    ? queryClient.getQueryData<ConversationDetailDto>(queryKeys.conversation(activeConversationId))
    : null;
  const hasPendingForThis = Boolean(
    activeConversationId &&
      !cachedDetail &&
      (peekPendingMessage()?.conversationId === activeConversationId || liveRunRef.current),
  );

  // TanStack Query hooks
  const { data: authUser, isLoading: isLoadingUser } = useUser();
  const { data: catalog } = useModelCatalog();
  const { data: conversations = [], isLoading: isLoadingConversations } = useConversations();
  const { data: githubStatus } = useGithubStatus();
  const { data: mcpConnectors = [] } = useMcpConnectors();
  const activeMcpCount = mcpConnectors.filter((c) => c.status === "ACTIVE").length;
  const disconnectGithub = useDisconnectGithub();
  const { data: activeConversation, isFetching: isFetchingDetail } = useConversationDetail(
    hasPendingForThis ? null : activeConversationId,
  );
  const isLoadingDetail = isFetchingDetail && !activeConversation;

  // Mutations
  const deleteMutation = useDeleteConversation();
  const updateModelMutation = useUpdateConversationModel();

  const {
    composerValue,
    setComposerValue,
    composerAttachments,
    setComposerAttachments,
    stagedRepoBinding,
    setStagedRepoBinding,
    composerInputRef,
  } = useComposerState();
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const renameMutation = useRenameConversation();
  const starMutation = useToggleConversationStar();
  const { pendingFiles, setPendingFiles, isDraggingOver, setIsDraggingOver, fileInputRef, handleUpload } =
    useFileUpload({
      activeConversationId,
      activeConversation,
      previewUrlMapRef,
      setComposerAttachments,
    });
  const {
    connectorModalOpen,
    setConnectorModalOpen,
    repoModalOpen,
    setRepoModalOpen,
    repoChipOpen,
    setRepoChipOpen,
    secretsModalOpen,
    setSecretsModalOpen,
    searchModalOpen,
    setSearchModalOpen,
    plusMenuOpen,
    setPlusMenuOpen,
    renamingConversation,
    setRenamingConversation,
  } = useModalState();
  const plusButtonRef = useRef<HTMLButtonElement | null>(null);
  const deferredSidebarQuery = useDeferredValue(sidebarQuery);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasLandingRef = useRef(true);
  const [animateComposerDock, setAnimateComposerDock] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const storedModel = activeConversation?.mainAgentModel;
  const availableIds = catalog?.availableMainModels.map((m) => m.id);
  const isStoredModelValid = storedModel && availableIds?.includes(storedModel);
  const selectedMainModelId =
    (isStoredModelValid ? storedModel : null) ?? userPreferences.agent.model ?? catalog?.mainAgentModel ?? "";

  const closeMenusOnOutsidePress = useEffectEvent((event: MouseEvent) => {
    if (profileRef.current && event.target instanceof Node && !profileRef.current.contains(event.target)) {
      setProfileMenuOpen(false);
    }

    if (!(event.target instanceof Element) || !event.target.closest("[data-chat-action-menu]")) {
      setOpenConversationMenuId(null);
      setHeaderMenuOpen(false);
      setModelMenuOpen(false);
      setPlusMenuOpen(false);
      setRepoChipOpen(false);
    }
  });

  useEffect(() => {
    document.addEventListener("mousedown", closeMenusOnOutsidePress);

    return () => {
      document.removeEventListener("mousedown", closeMenusOnOutsidePress);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const syncViewport = (event?: MediaQueryListEvent) => {
      const matches = event?.matches ?? mediaQuery.matches;
      setIsMobileViewport(matches);
      if (!matches) {
        setMobileSidebarOpen(false);
      }
    };

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  const runs = useMemo(() => activeConversation?.runs ?? [], [activeConversation?.runs]);

  const { showScrollDown, transcriptRef, stageRef, latestRunRef, footerRef, syncScrollShadows, scrollToBottom } =
    useScrollManager({ liveRun, runs, activeConversationId });

  const isNewChat = !activeConversationId;
  const hasLiveContent = Boolean(liveRun);
  const isLandingState = !hasLiveContent && (isNewChat || (!isLoadingDetail && runs.length === 0));

  // No immediate liveRun clearing effect — the liveRun div is already suppressed by the
  // render guard (`!runs.some(r => r.id === liveRun.runId)`) as soon as the fetched runs
  // include it. Eagerly calling setLiveRun(null) caused a DOM swap between the liveRun
  // wrapper and the fetched-run wrapper (different minHeights, different React nodes),
  // triggering a browser layout shift that scrolled the page up.
  // liveRun is cleaned up naturally on navigation (handleSelectConversation / new mount).

  // Only animate the composer dock when going from the /chat/new landing to a conversation
  // (first message sent). Don't animate when switching between existing chats.
  useEffect(() => {
    if (wasLandingRef.current && !isLandingState && isNewChat === false) {
      setAnimateComposerDock(true);

      const timeout = window.setTimeout(() => {
        setAnimateComposerDock(false);
      }, 460);

      wasLandingRef.current = false;
      return () => window.clearTimeout(timeout);
    }

    wasLandingRef.current = isNewChat;
  }, [isLandingState, isNewChat]);

  usePendingMessage({
    conversationId,
    activeConversationId,
    activeConversation,
    streamStartedForRef,
    setPendingFiles,
    previewUrlMapRef,
    setStagedRepoBinding,
    stagedRepoBinding,
    startStream,
  });

  useEffect(() => {
    setOpenConversationMenuId(null);
    setHeaderMenuOpen(false);
    setModelMenuOpen(false);
    setMobileSidebarOpen(false);
  }, [activeConversationId]);

  const filteredConversations = useMemo(() => {
    // Deduplicate — optimistic updates + concurrent invalidations can briefly produce duplicates
    const seen = new Set<string>();
    const deduped = conversations.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    const query = deferredSidebarQuery.trim().toLowerCase();

    if (!query) {
      return deduped;
    }

    return deduped.filter((conversation) => {
      return (
        conversation.title.toLowerCase().includes(query) ||
        previewText(conversation.latestSnippet).toLowerCase().includes(query)
      );
    });
  }, [conversations, deferredSidebarQuery]);

  const starredConversations = useMemo(() => filteredConversations.filter((c) => c.isStarred), [filteredConversations]);
  const recentConversations = useMemo(() => filteredConversations.filter((c) => !c.isStarred), [filteredConversations]);

  function handleCreateConversation() {
    setLiveRun(null);
    setComposerAttachments([]);
    setComposerValue("");
    setOpenConversationMenuId(null);
    setHeaderMenuOpen(false);
    setMobileSidebarOpen(false);
    navigateTo(null);
  }

  async function handleDeleteConversation(conversationId: string) {
    if (deletingConversationId) return;

    setDeletingConversationId(conversationId);
    setErrorMessage(null);
    setOpenConversationMenuId(null);
    setHeaderMenuOpen(false);
    setMobileSidebarOpen(false);

    const wasActive = activeConversationId === conversationId;

    deleteMutation.mutate(conversationId, {
      onSuccess: () => {
        if (wasActive) {
          const remaining = conversations.filter((c) => c.id !== conversationId);
          if (remaining.length > 0) {
            navigateTo(remaining[0]!.id);
          } else {
            navigateTo(null);
            setLiveRun(null);
            setComposerAttachments([]);
            setComposerValue("");
          }
        }
      },
      onError: (error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to delete the chat.");
      },
      onSettled: () => {
        setDeletingConversationId(null);
      },
    });

    if (wasActive) {
      setLiveRun(null);
      setComposerAttachments([]);
      setComposerValue("");
    }
  }

  function handleSend() {
    if (!composerValue.trim() || isSending) return;
    // Block send while any files are actively uploading (on existing conversations)
    if (pendingFiles.some((pf) => pf.status === "uploading")) return;

    const prompt = composerValue.trim();
    const attachments = composerAttachments;

    // Clear composer state before streaming
    setComposerValue("");
    setComposerAttachments([]);
    setPendingFiles([]);

    if (activeConversation) {
      // Existing chat — stream directly
      void startStream(activeConversation.id, prompt, attachments, false);
    } else {
      // /chat/new — carry staged files + repo binding through navigation
      const stagedFiles = pendingFiles
        .filter((pf) => pf.status === "staged")
        .map(({ clientId, file, previewUrl }) => ({ clientId, file, previewUrl }));

      const newId = crypto.randomUUID();
      setPendingMessage({
        conversationId: newId,
        prompt,
        attachments,
        stagedFiles: stagedFiles.length > 0 ? stagedFiles : undefined,
        stagedRepoBindingId: stagedRepoBinding?.id ?? undefined,
        stagedRepoFullName: stagedRepoBinding?.repoFullName ?? undefined,
      });
      setIsSending(true);
      router.push(`/chat/${newId}`);
    }
  }

  function handleSelectMainModel(modelId: string) {
    setModelMenuOpen(false);

    // Save as global default preference
    savePreferences({ agent: { ...userPreferences.agent, model: modelId } });

    // Also update the current conversation's model if we have one
    if (activeConversation && activeConversation.mainAgentModel !== modelId) {
      setErrorMessage(null);
      updateModelMutation.mutate(
        { id: activeConversation.id, model: modelId },
        {
          onError: (error) => {
            setErrorMessage(error instanceof Error ? error.message : "Failed to update the model.");
          },
        },
      );
    }
  }

  function handleSelectConversation(id: string) {
    if (id === activeConversationId) return;
    navigateTo(id);
    setLiveRun(null);
    setErrorMessage(null);
    setMobileSidebarOpen(false);
  }

  // Prefetch a conversation's detail into TanStack cache (fire-and-forget, respects staleTime)
  const prefetchConversation = useCallback(
    (id: string) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.conversation(id),
        queryFn: () =>
          api.get<{ conversation: ConversationDetailDto }>(`/api/conversations/${id}`).then((d) => d.conversation),
        staleTime: 30 * 1000,
      });
    },
    [queryClient],
  );

  // Proactively prefetch top 3 conversations on list load for instant switching
  useEffect(() => {
    if (!conversations.length) return;
    const top = conversations.filter((c) => c.id !== activeConversationId).slice(0, 3);
    for (const c of top) {
      prefetchConversation(c.id);
    }
  }, [conversations, activeConversationId, prefetchConversation]);

  const showCollapsedSidebar = sidebarCollapsed && !isMobileViewport;

  return (
    <div className={`app-shell ${showCollapsedSidebar ? "app-shell-collapsed" : ""}`}>
      {isMobileViewport && mobileSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[34] border-0 bg-[rgba(0,0,0,0.48)] backdrop-blur-[3px] max-[980px]:block hidden"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={[
          "sidebar-panel relative flex min-h-0 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[#232321] overflow-hidden transition-[padding] duration-[260ms] [transition-timing-function:cubic-bezier(0.2,0.9,0.2,1)] z-20",
          showCollapsedSidebar ? "py-3.5 px-0 items-center gap-1" : "pt-4 px-2 pb-3",
          isMobileViewport && mobileSidebarOpen ? "sidebar-panel-mobile-open" : "",
        ].join(" ")}
      >
        {showCollapsedSidebar ? (
          <>
            <div className="flex flex-1 flex-col items-center gap-1">
              <button
                type="button"
                className="inline-grid h-10 w-10 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.92)] mb-3"
                aria-label="Expand sidebar"
                onClick={() => setSidebarCollapsed(false)}
              >
                <IconSidebarToggle />
              </button>
              <button
                type="button"
                className="inline-grid h-10 w-10 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.92)]"
                aria-label="New chat"
                onClick={handleCreateConversation}
              >
                <IconPlus />
              </button>
              <button
                type="button"
                className="inline-grid h-10 w-10 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.92)]"
                aria-label="Search chats"
                onClick={() => setSearchModalOpen(true)}
              >
                <IconSearch />
              </button>
            </div>
            <div
              className="w-9 h-9 rounded-full bg-[rgba(245,240,232,0.12)] text-[rgba(245,240,232,0.88)] grid place-items-center text-[0.72rem] font-semibold cursor-pointer transition-[background] duration-[180ms] ease-linear hover:bg-[rgba(245,240,232,0.2)]"
              role="button"
              tabIndex={0}
              onClick={() => setSidebarCollapsed(false)}
            >
              N
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-1 pt-0.5 mb-4">
              <div className="font-serif text-[1.35rem] font-bold leading-none tracking-[-0.03em] text-[rgba(247,242,233,0.96)]">
                Relay AI
              </div>
              {isMobileViewport ? (
                <button
                  type="button"
                  className="inline-grid h-[34px] w-[34px] place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[8px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.92)]"
                  aria-label="Close sidebar"
                  onClick={() => setMobileSidebarOpen(false)}
                >
                  <IconClose />
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-grid h-[34px] w-[34px] place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[8px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.92)]"
                  aria-label="Collapse sidebar"
                  onClick={() => setSidebarCollapsed(true)}
                >
                  <IconSidebarToggle />
                </button>
              )}
            </div>

            <button
              type="button"
              className="group flex items-center gap-3 w-full border-0 rounded-[10px] bg-transparent text-[rgba(236,230,219,0.82)] cursor-pointer py-[9px] px-2.5 text-left text-[0.9rem] leading-[1.25] transition-[background,color] duration-[140ms] ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.96)]"
              onClick={handleCreateConversation}
            >
              <span className="inline-grid shrink-0 w-5 h-5 place-items-center text-[rgba(236,230,219,0.72)] group-hover:text-[rgba(247,242,233,0.92)]">
                <IconPlus />
              </span>
              <span>New chat</span>
            </button>

            <button
              type="button"
              className="group flex items-center gap-3 w-full border-0 rounded-[10px] bg-transparent text-[rgba(236,230,219,0.82)] cursor-pointer py-[9px] px-2.5 text-left text-[0.9rem] leading-[1.25] transition-[background,color] duration-[140ms] ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.96)]"
              onClick={() => setSearchModalOpen(true)}
            >
              <span className="inline-grid shrink-0 w-5 h-5 place-items-center text-[rgba(236,230,219,0.72)] group-hover:text-[rgba(247,242,233,0.92)]">
                <IconSearch />
              </span>
              <span>Search</span>
            </button>

            <div className="sidebar-conversation-list flex flex-1 min-h-0 flex-col gap-px overflow-y-auto overflow-x-hidden -mx-1 px-1">
              {isLoadingConversations ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex w-full items-center py-[9px] px-2.5">
                    <div
                      className="h-[18px] rounded-[6px] bg-[rgba(255,255,255,0.06)] animate-pulse"
                      style={{ width: `${50 + (i % 3) * 20}%` }}
                    />
                  </div>
                ))
              ) : (
                <>
                  {starredConversations.length > 0 && (
                    <>
                      <div className="text-[0.68rem] uppercase tracking-[0.1em] text-[rgba(236,230,219,0.38)] pt-3 px-2.5 pb-1">
                        Starred
                      </div>
                      {starredConversations.map((conversation) => {
                        const isActive = conversation.id === activeConversationId;
                        const isMenuOpen = openConversationMenuId === conversation.id;
                        const isDeleting = deletingConversationId === conversation.id;
                        return (
                          <div
                            key={conversation.id}
                            className={`group/row relative ${isActive || isMenuOpen ? "z-[2]" : ""}`}
                          >
                            <button
                              type="button"
                              className={`flex w-full items-center border-0 rounded-[10px] text-inherit cursor-pointer py-[9px] pr-[34px] pl-2.5 text-left transition-[background] duration-[140ms] ease-linear hover:bg-[#2f2f2d] ${isActive ? "bg-[#2f2f2d]" : "bg-transparent"}`}
                              onClick={() => handleSelectConversation(conversation.id)}
                              onMouseEnter={() => prefetchConversation(conversation.id)}
                            >
                              <div
                                className={`text-[0.88rem] font-[420] text-[rgba(242,237,229,0.82)] whitespace-nowrap overflow-hidden text-ellipsis ${isActive ? "text-[rgba(247,242,233,0.96)]" : "group-hover/row:text-[rgba(247,242,233,0.96)]"}`}
                              >
                                {isActive && conversation.title === "New chat" && liveRun ? (
                                  <span className="inline-block w-[100px] h-[0.88em] rounded-[3px] bg-[rgba(255,255,255,0.08)] animate-pulse" />
                                ) : (
                                  conversation.title
                                )}
                              </div>
                            </button>

                            <div className="absolute top-1/2 right-1 -translate-y-1/2" data-chat-action-menu>
                              <button
                                type="button"
                                className={`inline-grid h-[26px] w-[26px] place-items-center border-0 bg-transparent rounded-[6px] text-[rgba(245,240,232,0.46)] cursor-pointer transition-[opacity,color,background] duration-[140ms] ease-linear hover:text-[rgba(245,240,232,0.88)] hover:bg-[#2f2f2d] ${isMenuOpen || isActive ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}
                                aria-label={`Open menu for ${conversation.title}`}
                                aria-expanded={isMenuOpen}
                                data-conversation-menu={conversation.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setHeaderMenuOpen(false);
                                  setOpenConversationMenuId((current) =>
                                    current === conversation.id ? null : conversation.id,
                                  );
                                }}
                              >
                                <IconMore />
                              </button>

                              {isMenuOpen ? (
                                <SidebarMenuPortal
                                  triggerSelector={`[data-conversation-menu="${conversation.id}"]`}
                                  isStarred={conversation.isStarred}
                                  onToggleStar={() => {
                                    setOpenConversationMenuId(null);
                                    starMutation.mutate({ id: conversation.id, isStarred: !conversation.isStarred });
                                  }}
                                  onRename={() => {
                                    setOpenConversationMenuId(null);
                                    setRenamingConversation({ id: conversation.id, title: conversation.title });
                                  }}
                                  onDelete={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteConversation(conversation.id);
                                  }}
                                  isDeleting={isDeleting}
                                />
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                  <div className="text-[0.68rem] uppercase tracking-[0.1em] text-[rgba(236,230,219,0.38)] pt-3 px-2.5 pb-1">
                    {starredConversations.length > 0 ? "Recents" : "Chats"}
                  </div>
                  {recentConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    const isMenuOpen = openConversationMenuId === conversation.id;
                    const isDeleting = deletingConversationId === conversation.id;
                    return (
                      <div
                        key={conversation.id}
                        className={`group/row relative ${isActive || isMenuOpen ? "z-[2]" : ""}`}
                      >
                        <button
                          type="button"
                          className={`flex w-full items-center border-0 rounded-[10px] text-inherit cursor-pointer py-[9px] pr-[34px] pl-2.5 text-left transition-[background] duration-[140ms] ease-linear hover:bg-[#2f2f2d] ${isActive ? "bg-[#2f2f2d]" : "bg-transparent"}`}
                          onClick={() => handleSelectConversation(conversation.id)}
                          onMouseEnter={() => prefetchConversation(conversation.id)}
                        >
                          <div
                            className={`text-[0.88rem] font-[420] text-[rgba(242,237,229,0.82)] whitespace-nowrap overflow-hidden text-ellipsis ${isActive ? "text-[rgba(247,242,233,0.96)]" : "group-hover/row:text-[rgba(247,242,233,0.96)]"}`}
                          >
                            {isActive && conversation.title === "New chat" && liveRun ? (
                              <span className="inline-block w-[100px] h-[0.88em] rounded-[3px] bg-[rgba(255,255,255,0.08)] animate-pulse" />
                            ) : (
                              conversation.title
                            )}
                          </div>
                        </button>

                        <div className="absolute top-1/2 right-1 -translate-y-1/2" data-chat-action-menu>
                          <button
                            type="button"
                            className={`inline-grid h-[26px] w-[26px] place-items-center border-0 bg-transparent rounded-[6px] text-[rgba(245,240,232,0.46)] cursor-pointer transition-[opacity,color,background] duration-[140ms] ease-linear hover:text-[rgba(245,240,232,0.88)] hover:bg-[#2f2f2d] ${isMenuOpen || isActive ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}
                            aria-label={`Open menu for ${conversation.title}`}
                            aria-expanded={isMenuOpen}
                            data-conversation-menu={conversation.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setHeaderMenuOpen(false);
                              setOpenConversationMenuId((current) =>
                                current === conversation.id ? null : conversation.id,
                              );
                            }}
                          >
                            <IconMore />
                          </button>

                          {isMenuOpen ? (
                            <SidebarMenuPortal
                              triggerSelector={`[data-conversation-menu="${conversation.id}"]`}
                              isStarred={conversation.isStarred}
                              onToggleStar={() => {
                                setOpenConversationMenuId(null);
                                starMutation.mutate({ id: conversation.id, isStarred: !conversation.isStarred });
                              }}
                              onRename={() => {
                                setOpenConversationMenuId(null);
                                setRenamingConversation({ id: conversation.id, title: conversation.title });
                              }}
                              onDelete={(event) => {
                                event.stopPropagation();
                                void handleDeleteConversation(conversation.id);
                              }}
                              isDeleting={isDeleting}
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            <div className="relative mt-auto pt-2 border-t border-[rgba(255,255,255,0.06)]" ref={profileRef}>
              {isLoadingUser ? (
                <div className="grid w-full grid-cols-[36px_1fr_16px] items-center gap-2.5 rounded-[10px] py-2.5 px-2 animate-pulse">
                  <div className="h-9 w-9 rounded-full bg-[rgba(255,255,255,0.08)]" />
                  <div className="min-w-0 space-y-1.5">
                    <div className="h-[14px] w-24 rounded bg-[rgba(255,255,255,0.08)]" />
                    <div className="h-[12px] w-36 rounded bg-[rgba(255,255,255,0.06)]" />
                  </div>
                  <div className="h-4 w-4" />
                </div>
              ) : (
                <button
                  type="button"
                  className="grid w-full grid-cols-[36px_1fr_16px] items-center gap-2.5 border-0 rounded-[10px] bg-transparent text-inherit cursor-pointer py-2.5 px-2 text-left transition-[background] duration-[140ms] ease-linear hover:bg-[#2f2f2d]"
                  onClick={() => setProfileMenuOpen((current) => !current)}
                >
                  {authUser?.avatarUrl ? (
                    <Image
                      src={authUser.avatarUrl}
                      alt=""
                      width={36}
                      height={36}
                      className="h-9 w-9 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                      unoptimized
                    />
                  ) : (
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-[rgba(237,233,225,0.12)] text-[0.72rem] font-semibold">
                      {(authUser?.fullName?.[0] ?? authUser?.email?.[0] ?? "U").toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[0.88rem] text-[rgba(245,240,232,0.88)]">
                      {authUser?.fullName ?? authUser?.email ?? "Account"}
                    </div>
                    <div className="truncate text-[0.72rem] text-[rgba(236,230,219,0.44)]">{authUser?.email ?? ""}</div>
                  </div>
                  <span className="inline-grid place-items-center text-[rgba(236,230,219,0.36)]">
                    <IconChevron />
                  </span>
                </button>
              )}

              {profileMenuOpen ? (
                <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 border border-[rgba(255,255,255,0.12)] rounded-[16px] bg-[linear-gradient(180deg,rgba(63,61,56,0.96),rgba(53,51,47,0.96))] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.34)] backdrop-blur-[18px]">
                  {githubStatus?.configured ? (
                    <div className="pb-2 mb-1 border-b border-[rgba(255,255,255,0.08)]">
                      {githubStatus.installed ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("Uninstall the GitHub App? You can reinstall it later.")) {
                              disconnectGithub.mutate();
                            }
                          }}
                          className="flex w-full items-center gap-2.5 rounded-[8px] border-0 bg-transparent text-left text-[0.8rem] cursor-pointer py-[7px] px-1 transition-colors duration-100 group/gh"
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="text-[rgba(245,240,232,0.5)] shrink-0"
                            aria-hidden="true"
                          >
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                          </svg>
                          <span className="flex-1 text-[rgba(245,240,232,0.55)] group-hover/gh:text-[rgba(245,240,232,0.85)]">
                            {disconnectGithub.isPending ? "Uninstalling…" : "Uninstall GitHub App"}
                          </span>
                          <span className="h-1.5 w-1.5 rounded-full bg-[rgba(122,168,148,0.8)]" title="Installed" />
                        </button>
                      ) : (
                        <a
                          href={githubStatus.installUrl ?? "/api/github/install"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex w-full items-center gap-2.5 rounded-[8px] no-underline text-left text-[0.8rem] cursor-pointer py-[7px] px-1 transition-colors duration-100 group/gh"
                          onClick={() => {
                            const interval = setInterval(() => {
                              void queryClient.invalidateQueries({ queryKey: queryKeys.githubStatus });
                            }, 3000);
                            setTimeout(() => clearInterval(interval), 120_000);
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="text-[rgba(245,240,232,0.5)] shrink-0"
                            aria-hidden="true"
                          >
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                          </svg>
                          <span className="flex-1 text-[rgba(245,240,232,0.55)] group-hover/gh:text-[rgba(245,240,232,0.85)]">
                            Install GitHub App
                          </span>
                        </a>
                      )}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="w-full rounded-[8px] border-0 bg-transparent text-left text-[0.8rem] text-[rgba(245,240,232,0.55)] cursor-pointer py-[7px] px-1 transition-colors duration-100 hover:text-[rgba(245,240,232,0.85)]"
                    onClick={async () => {
                      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
                      const supabase = getSupabaseBrowserClient();
                      await supabase.auth.signOut();
                      router.push("/login");
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </aside>

      <main className="grid min-h-0 h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden min-w-0 max-[980px]:h-dvh max-[980px]:min-h-dvh max-[980px]:w-full max-[980px]:max-w-full">
        <header className="flex items-center justify-start gap-[18px] p-3 max-[980px]:gap-2 max-[980px]:pt-3 max-[980px]:pb-1 max-[980px]:px-[18px]">
          <div className="flex min-w-0 w-full items-center gap-0 max-[980px]:w-full max-[980px]:gap-2">
            {isMobileViewport ? (
              <button
                type="button"
                className="hidden max-[980px]:inline-grid h-10 w-10 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-140 ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.92)] shrink-0"
                aria-label={mobileSidebarOpen ? "Close navigation" : "Open navigation"}
                aria-expanded={mobileSidebarOpen}
                onClick={() => setMobileSidebarOpen((current) => !current)}
              >
                <IconSidebarToggle />
              </button>
            ) : null}

            {activeConversation ? (
              <div
                className="relative min-w-0 max-w-full max-[980px]:flex-auto max-[980px]:min-w-0 max-[980px]:max-w-[calc(100%-48px)]"
                data-chat-action-menu
              >
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 w-auto max-w-[min(100%,42rem)] min-w-0 border-0 rounded-[10px] bg-transparent text-[rgba(235,230,220,0.82)] cursor-pointer py-1.5 px-2.5 overflow-hidden transition-[color,background] duration-[140ms] ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(245,240,232,0.96)] max-[980px]:max-w-full max-[980px]:border-0 max-[980px]:rounded-none max-[980px]:bg-transparent max-[980px]:p-0`}
                  aria-label={`Open menu for ${activeConversation.title}`}
                  aria-expanded={headerMenuOpen}
                  data-header-menu-trigger
                  onClick={() => {
                    setOpenConversationMenuId(null);
                    setHeaderMenuOpen((current) => !current);
                  }}
                >
                  {activeConversation.title === "New chat" && liveRun ? (
                    <span className="min-w-0 flex-[0_1_auto] p-0 text-[0.96rem] font-[430] leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis max-[980px]:text-[0.92rem]">
                      <span className="inline-block w-[140px] h-[1em] rounded-[4px] bg-[rgba(255,255,255,0.08)] animate-pulse" />
                    </span>
                  ) : (
                    <span className="min-w-0 flex-[0_1_auto] p-0 text-[0.96rem] font-[430] leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis max-[980px]:text-[0.92rem] max-[980px]:p-0 max-[980px]:whitespace-nowrap">
                      {activeConversation.title}
                    </span>
                  )}
                  <span className="hidden" aria-hidden="true" />
                  <span
                    className={`inline-grid w-auto place-items-center text-[rgba(245,240,232,0.54)] transition-[transform,color] duration-[180ms] ease-linear max-[980px]:w-auto ${headerMenuOpen ? "rotate-180 text-[rgba(245,240,232,0.9)]" : ""}`}
                    aria-hidden="true"
                  >
                    <IconChevron />
                  </span>
                </button>

                {headerMenuOpen ? (
                  <SidebarMenuPortal
                    triggerSelector={`[data-header-menu-trigger]`}
                    isStarred={activeConversation.isStarred}
                    onToggleStar={() => {
                      setHeaderMenuOpen(false);
                      starMutation.mutate({ id: activeConversation.id, isStarred: !activeConversation.isStarred });
                    }}
                    onRename={() => {
                      setHeaderMenuOpen(false);
                      setRenamingConversation({ id: activeConversation.id, title: activeConversation.title });
                    }}
                    onDelete={(event) => {
                      event.stopPropagation();
                      void handleDeleteConversation(activeConversation.id);
                    }}
                    isDeleting={deletingConversationId === activeConversation.id}
                  />
                ) : null}
              </div>
            ) : activeConversationId ? (
              <div className="min-w-0 flex-[0_1_auto] py-1.5 px-2.5 text-[0.96rem] leading-[1.2]">
                <span className="inline-block w-[140px] h-[1em] rounded-[4px] bg-[rgba(255,255,255,0.08)] animate-pulse align-middle" />
              </div>
            ) : null}
          </div>
        </header>

        <div className="chat-stage relative min-h-0 overflow-hidden min-w-0" ref={stageRef}>
          {isLoadingDetail && !hasLiveContent ? (
            <div className="h-full pt-6 px-[30px] max-[980px]:px-[18px]">
              <div className="max-w-[860px] mx-auto flex flex-col gap-5">
                <div className="flex justify-end">
                  <div className="h-[42px] w-[160px] rounded-[20px] bg-[rgba(255,255,255,0.06)] animate-pulse" />
                </div>
                <div className="flex flex-col gap-[10px] mt-2">
                  <div
                    className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.07)] animate-pulse"
                    style={{ width: "82%" }}
                  />
                  <div
                    className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.06)] animate-pulse"
                    style={{ width: "95%" }}
                  />
                  <div
                    className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.07)] animate-pulse"
                    style={{ width: "88%" }}
                  />
                  <div
                    className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.06)] animate-pulse"
                    style={{ width: "74%" }}
                  />
                  <div
                    className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.07)] animate-pulse"
                    style={{ width: "91%" }}
                  />
                  <div
                    className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.06)] animate-pulse"
                    style={{ width: "80%" }}
                  />
                  <div
                    className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.05)] animate-pulse"
                    style={{ width: "65%" }}
                  />
                  <div
                    className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.06)] animate-pulse"
                    style={{ width: "72%" }}
                  />
                </div>
                <div className="h-[13px] w-[120px] rounded-[4px] bg-[rgba(255,255,255,0.04)] animate-pulse mt-4" />
              </div>
            </div>
          ) : isLandingState ? (
            <section className="chat-landing flex h-full flex-col items-center justify-center gap-4 pt-9 px-[30px] pb-[280px] text-center overflow-hidden max-[980px]:px-[18px] max-[980px]:pt-0 max-[980px]:pb-[140px] max-[980px]:gap-3">
              {errorMessage ? (
                <div className="max-w-[720px] mx-auto mb-[18px] border border-[rgba(181,103,69,0.3)] rounded-[18px] bg-[rgba(181,103,69,0.12)] text-[#f3c7b4] px-4 py-3.5">
                  {errorMessage}
                </div>
              ) : null}
              <div className="inline-flex items-center justify-center rounded-full bg-[rgba(10,10,10,0.42)] text-[rgba(245,240,232,0.64)] py-2.5 px-4 text-[0.82rem] tracking-[0.12em] uppercase max-[980px]:text-[0.72rem] max-[980px]:py-[7px] max-[980px]:px-3">
                AI chat
              </div>
              <div className="flex items-center gap-3.5 max-[980px]:flex-col max-[980px]:gap-2">
                <span className="inline-grid h-8 w-8 place-items-center text-[#cf6d43] max-[980px]:h-6 max-[980px]:w-6">
                  <IconSpark />
                </span>
                <h1 className="m-0 font-serif text-[clamp(2rem,4vw,4.2rem)] leading-[0.94] tracking-[-0.04em]">
                  {authUser?.fullName
                    ? `What shall we think through, ${authUser.fullName.split(" ")[0]}?`
                    : "What shall we think through?"}
                </h1>
              </div>
              <p className="max-w-[58rem] m-0 text-[rgba(245,240,232,0.6)] text-base leading-[1.7] max-[980px]:text-[0.88rem] max-[980px]:leading-[1.55]">
                Ask questions, upload files, research ideas, and move from planning to execution in one conversation.
              </p>
            </section>
          ) : (
            <div
              className="chat-stage-inner h-full overflow-y-auto overflow-x-hidden overscroll-contain [overflow-anchor:none] pt-6 px-[30px] pb-[236px] min-w-0 max-[980px]:px-[6px] max-[980px]:w-full max-[980px]:max-w-full max-[980px]:pb-[180px]"
              ref={transcriptRef}
              onScroll={syncScrollShadows}
            >
              <div className="chat-transcript-inner min-h-0 min-w-0 max-w-3xl! mx-auto px-1 sm:px-5">
                {errorMessage ? (
                  <div className="max-w-[860px] mx-auto mb-[18px] border border-[rgba(181,103,69,0.3)] rounded-[18px] bg-[rgba(181,103,69,0.12)] text-[#f3c7b4] px-4 py-3.5">
                    {errorMessage}
                  </div>
                ) : null}

                {(() => {
                  const isLiveRunSeparate = liveRun && !runs.some((r) => r.id === liveRun.runId);
                  const lastRunIndex = runs.length - 1;

                  return runs.map((run, index) => {
                    const isLastCompleted = index === lastRunIndex && !isLiveRunSeparate;

                    if (isLastCompleted) {
                      // Keep min-height only when liveRun just completed for this run (prevents
                      // scroll jump during the liveRun→fetched swap). On page load or navigation
                      // liveRun is null so no excessive scrollable space is created.
                      const justStreamed = liveRun?.runId === run.id;
                      return (
                        <div
                          key={run.id}
                          ref={latestRunRef}
                          style={justStreamed ? { minHeight: "calc(100vh - 140px)" } : undefined}
                        >
                          <RunThread
                            runId={run.id}
                            userPrompt={run.userPrompt}
                            attachments={run.attachments}
                            outputAttachments={run.outputAttachments}
                            events={run.events}
                            finalText={run.finalText}
                            createdAt={run.createdAt}
                            isLast
                            isInterrupted={run.status === "CANCELLED"}
                          />
                        </div>
                      );
                    }

                    return (
                      <RunThread
                        key={run.id}
                        runId={run.id}
                        userPrompt={run.userPrompt}
                        attachments={run.attachments}
                        outputAttachments={run.outputAttachments}
                        events={run.events}
                        finalText={run.finalText}
                        createdAt={run.createdAt}
                        isInterrupted={run.status === "CANCELLED"}
                      />
                    );
                  });
                })()}

                {liveRun && !runs.some((r) => r.id === liveRun.runId) ? (
                  <div ref={latestRunRef} style={{ minHeight: "calc(100vh - 180px)" }}>
                    <RunThread
                      runId={liveRun.runId}
                      userPrompt={liveRun.userPrompt}
                      attachments={liveRun.attachments}
                      outputAttachments={liveRun.outputAttachments}
                      events={liveRun.events}
                      finalText={liveRun.partialText || null}
                      createdAt={new Date().toISOString()}
                      isLive={liveRun.status === "running"}
                      isInterrupted={liveRun.status === "interrupted" || liveRun.status === "failed"}
                      previewUrls={previewUrlMapRef.current}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <footer
            ref={footerRef}
            className={[
              "absolute left-0 right-0 z-20 pb-1 transition-[transform,opacity] duration-[420ms] [transition-timing-function:cubic-bezier(0.2,0.9,0.2,1)]",
              isLandingState && isNewChat
                ? "bottom-1/2 px-[30px] translate-y-[120px] max-[980px]:bottom-0  max-[980px]:translate-y-0 max-[980px]:px-[18px]"
                : "bottom-0 px-[30px]  bg-background max-[980px]:px-[18px] ",
              animateComposerDock ? "composer-panel-animate-dock" : "",
            ].join(" ")}
          >
            {/* Scroll-to-bottom button — anchored 12px above the composer shell */}
            {showScrollDown && !isLandingState && (
              <button
                type="button"
                aria-label="Scroll to bottom"
                className="absolute left-1/2 -translate-x-1/2 -top-11 h-8 w-8 rounded-full border border-[rgba(255,255,255,0.1)] bg-[#30302e] shadow-[0_2px_8px_rgba(0,0,0,0.2)] flex items-center justify-center text-[rgba(236,230,219,0.5)] hover:text-[rgba(236,230,219,0.8)] hover:border-[rgba(255,255,255,0.18)] transition-all duration-150 cursor-pointer"
                onClick={() => {
                  scrollToBottom();
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3v10M3 8.5l5 5 5-5" />
                </svg>
              </button>
            )}
            <div
              className={`composer-shell flex max-w-3xl w-full min-w-0 min-h-[96px] flex-col gap-3 mx-auto border rounded-[22px] bg-[#30302e] pt-[14px] px-[18px] pb-3.5 shadow-[0_4px_16px_rgba(0,0,0,0.12)] max-[980px]:w-full max-[980px]:max-w-full max-[980px]:m-0 max-[980px]:min-h-0 max-[980px]:gap-2.5 max-[980px]:pt-3 max-[980px]:px-3.5 max-[980px]:pb-2.5 max-[980px]:rounded-[18px] transition-[border-color] duration-150 ${isDraggingOver ? "border-[rgba(212,112,73,0.6)]" : "border-[rgba(255,255,255,0.08)]"}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                if (e.dataTransfer?.files?.length) {
                  void handleUpload(e.dataTransfer.files);
                }
              }}
            >
              {composerAttachments.length > 0 || pendingFiles.length > 0 ? (
                <div className="flex flex-wrap gap-2 mb-2">
                  {composerAttachments.map((attachment) => (
                    <AttachmentChip
                      key={attachment.id}
                      attachment={attachment}
                      previewUrl={previewUrlMapRef.current.get(attachment.id)}
                      onRemove={() => {
                        // Revoke cached preview URL when removing
                        const cached = previewUrlMapRef.current.get(attachment.id);
                        if (cached) {
                          URL.revokeObjectURL(cached);
                          previewUrlMapRef.current.delete(attachment.id);
                        }
                        setComposerAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
                        // Delete from Anthropic Files API + DB (fire-and-forget)
                        void api.del(`/api/attachments/${attachment.id}`);
                      }}
                    />
                  ))}
                  {pendingFiles.map((pf) => (
                    <AttachmentChip
                      key={pf.clientId}
                      pendingFile={pf}
                      onRemove={
                        pf.status !== "uploading"
                          ? () => {
                              setPendingFiles((prev) => {
                                const removed = prev.find((p) => p.clientId === pf.clientId);
                                if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
                                return prev.filter((p) => p.clientId !== pf.clientId);
                              });
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : null}

              <textarea
                ref={composerInputRef}
                className="composer-input max-h-[220px] resize-none border-0 bg-transparent text-foreground outline-0 p-0 text-base leading-[1.55] overflow-y-auto max-[980px]:max-h-[160px] max-[980px]:text-[0.95rem]"
                placeholder={isLandingState ? "How can I help today?" : "Reply..."}
                value={composerValue}
                onChange={(event) => {
                  setComposerValue(event.target.value);
                  resizeComposer(event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                onPaste={(event) => {
                  const items = event.clipboardData?.items;
                  if (!items) return;

                  const files: File[] = [];
                  for (const item of Array.from(items)) {
                    if (item.kind === "file") {
                      const file = item.getAsFile();
                      if (file) files.push(file);
                    }
                  }

                  if (files.length > 0) {
                    event.preventDefault();
                    const dt = new DataTransfer();
                    for (const f of files) dt.items.add(f);
                    void handleUpload(dt.files);
                  }
                }}
                rows={1}
              />

              <div className="flex items-center justify-between gap-[18px] max-[980px]:gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  multiple
                  accept="image/*,.pdf,.txt,.md,.json"
                  onChange={(event) => {
                    void handleUpload(event.target.files);
                  }}
                />

                <button
                  type="button"
                  className="inline-grid h-8 w-8 place-items-center rounded-full border-0 bg-transparent text-[rgba(255,255,255,0.6)] cursor-pointer hover:bg-[#2f2f2d] hover:text-[rgba(255,255,255,0.88)]"
                  ref={plusButtonRef}
                  onClick={() => setPlusMenuOpen((v) => !v)}
                  title="Add files, connectors, and more"
                  aria-label="Add files, connectors, and more"
                >
                  <IconPlus />
                </button>

                {plusMenuOpen && (
                  <ComposerPlusMenuPortal
                    anchor={plusButtonRef.current}
                    hasLinkedRepo={Boolean(activeConversation?.repoBinding || stagedRepoBinding)}
                    onAddFiles={() => {
                      setPlusMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    onAddConnectors={() => {
                      setPlusMenuOpen(false);
                      setConnectorModalOpen(true);
                    }}
                    onConnectRepo={() => {
                      setPlusMenuOpen(false);
                      setRepoModalOpen(true);
                    }}
                  />
                )}

                {(() => {
                  const displayedRepo =
                    activeConversation?.repoBinding ??
                    (stagedRepoBinding
                      ? {
                          id: stagedRepoBinding.id,
                          repoFullName: stagedRepoBinding.repoFullName,
                          repoName: stagedRepoBinding.repoFullName.split("/")[1],
                        }
                      : null);
                  if (!displayedRepo) return null;
                  const isStaged = !activeConversation?.repoBinding;
                  return (
                    <div className="relative min-w-0 shrink">
                      {/* Desktop: full chip with name + × */}
                      <div
                        className="hidden min-[981px]:inline-flex items-center gap-1.5 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1 text-[0.78rem] text-[rgba(245,240,232,0.65)]"
                        title={displayedRepo.repoFullName}
                      >
                        <IconGithub />
                        <span className="max-w-[160px] truncate">{displayedRepo.repoName}</span>
                        {!isStaged && (
                          <button
                            type="button"
                            className="inline-grid h-4 w-4 place-items-center border-0 bg-transparent text-[rgba(245,240,232,0.35)] cursor-pointer rounded-full p-0 transition-colors duration-140 hover:text-[rgba(245,240,232,0.7)]"
                            onClick={() => setSecretsModalOpen(true)}
                            aria-label="Manage environment variables"
                          >
                            <IconKey />
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-grid h-4 w-4 place-items-center border-0 bg-transparent text-[rgba(245,240,232,0.35)] cursor-pointer rounded-full p-0 transition-colors duration-140 hover:text-[rgba(245,240,232,0.7)]"
                          onClick={() => {
                            if (isStaged) {
                              setStagedRepoBinding(null);
                            } else if (activeConversation) {
                              linkRepoMutation.mutate({ conversationId: activeConversation.id, repoBindingId: null });
                            }
                          }}
                          aria-label="Unlink repository"
                        >
                          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3">
                            <path
                              d="M4 12L12 4M12 12L4 4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      </div>
                      {/* Mobile: icon-only button with click popover */}
                      <button
                        type="button"
                        className="min-[981px]:hidden inline-grid h-8 w-8 place-items-center rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-[rgba(245,240,232,0.65)] cursor-pointer p-0 transition-colors duration-140 hover:bg-[rgba(255,255,255,0.06)]"
                        onClick={() => setRepoChipOpen((v) => !v)}
                        aria-label={`Linked repo: ${displayedRepo.repoFullName}`}
                      >
                        <IconGithub />
                      </button>
                      {repoChipOpen && (
                        <div className="min-[981px]:hidden absolute bottom-full left-0 mb-2 z-50">
                          <div className="rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[rgba(28,26,22,0.96)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-xl px-3 py-2.5 whitespace-nowrap">
                            <div className="text-[0.78rem] text-[rgba(245,240,232,0.85)] font-medium">
                              {displayedRepo.repoFullName}
                            </div>
                            {!isStaged && (
                              <button
                                type="button"
                                className="mt-2 w-full text-left text-[0.75rem] text-[rgba(245,240,232,0.6)] cursor-pointer border-0 bg-transparent p-0 hover:text-[rgba(245,240,232,0.9)]"
                                onClick={() => {
                                  setSecretsModalOpen(true);
                                  setRepoChipOpen(false);
                                }}
                              >
                                Manage env vars
                              </button>
                            )}
                            <button
                              type="button"
                              className="mt-2 w-full text-left text-[0.75rem] text-[rgba(243,199,180,0.7)] cursor-pointer border-0 bg-transparent p-0 hover:text-[rgba(243,199,180,1)] flex items-center gap-1.5"
                              onClick={() => {
                                if (isStaged) {
                                  setStagedRepoBinding(null);
                                } else if (activeConversation) {
                                  linkRepoMutation.mutate({
                                    conversationId: activeConversation.id,
                                    repoBindingId: null,
                                  });
                                }
                                setRepoChipOpen(false);
                              }}
                              aria-label="Disconnect repo"
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 16 16"
                                className="h-3.5 w-3.5 shrink-0"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M6 10l-1.5 1.5a2.121 2.121 0 0 1-3-3L4 7" />
                                <path d="M10 6l1.5-1.5a2.121 2.121 0 0 0-3-3L7 4" />
                                <path d="M2 2l12 12" />
                              </svg>
                              Disconnect repo
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {activeMcpCount > 0 && (
                  <div className="group/mcp relative">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1 max-[980px]:px-2 text-[0.78rem] text-[rgba(245,240,232,0.55)] cursor-pointer transition-colors duration-140 hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(245,240,232,0.8)]"
                      onClick={() => setConnectorModalOpen(true)}
                      aria-label={`${activeMcpCount} MCP connector${activeMcpCount > 1 ? "s" : ""} connected`}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      >
                        <path d="M6 2v3M10 2v3M6 11v3M10 11v3M2 6h3M2 10h3M11 6h3M11 10h3" />
                        <rect x="5" y="5" width="6" height="6" rx="1" />
                      </svg>
                      <span className="max-[980px]:hidden">{activeMcpCount} MCP</span>
                      <span className="hidden max-[980px]:inline text-[0.7rem]">{activeMcpCount}</span>
                    </button>
                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 scale-95 group-hover/mcp:opacity-100 group-hover/mcp:scale-100 transition-[opacity,transform] duration-150 origin-bottom">
                      <div className="rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[rgba(28,26,22,0.96)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-xl px-3 py-2 whitespace-nowrap">
                        {mcpConnectors
                          .filter((c) => c.status === "ACTIVE")
                          .map((c) => (
                            <div key={c.id} className="flex items-center gap-2 py-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                              <span className="text-[0.76rem] text-[rgba(245,240,232,0.85)]">{c.name}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2.5 ml-auto">
                  <div className="relative" data-chat-action-menu>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border-0 bg-transparent text-[rgba(245,240,232,0.68)] text-[0.82rem] leading-none cursor-pointer py-2 px-2.5 transition-[background,color] duration-[180ms] ease-linear hover:bg-[rgba(255,255,255,0.045)] hover:text-[rgba(245,240,232,0.9)]"
                      aria-label="Select model"
                      aria-expanded={modelMenuOpen}
                      ref={modelButtonRef}
                      onClick={() => setModelMenuOpen((current) => !current)}
                    >
                      <span>{formatModelDisplayName(selectedMainModelId)}</span>
                      <IconChevron />
                    </button>

                    {modelMenuOpen && catalog ? (
                      <ComposerModelMenuPortal
                        anchor={modelButtonRef.current}
                        models={catalog.availableMainModels}
                        selectedModelId={selectedMainModelId}
                        isUpdating={updateModelMutation.isPending}
                        onSelect={(modelId) => {
                          handleSelectMainModel(modelId);
                        }}
                        preferences={agentPreferences}
                        onPreferencesChange={(prefs) => {
                          savePreferences({ agent: { ...userPreferences.agent, ...prefs } });
                        }}
                      />
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className={`inline-grid h-[40px] w-[40px] place-items-center rounded-[12px] border-0 cursor-pointer transition-[transform,background,opacity] duration-[180ms] ease-linear max-[980px]:h-[36px] max-[980px]:w-[36px] max-[980px]:rounded-[10px] ${
                      liveRun?.status === "running"
                        ? "bg-[#30302e] text-[rgba(236,230,219,0.7)] border border-[rgba(255,255,255,0.15)] hover:text-[rgba(236,230,219,0.95)] hover:border-[rgba(255,255,255,0.25)]"
                        : "bg-[#d47049] text-[#fff8f0] shadow-[0_6px_16px_rgba(207,109,67,0.25)] hover:not-disabled:-translate-y-px hover:not-disabled:bg-[#dd7851] disabled:opacity-50 disabled:cursor-not-allowed"
                    }`}
                    onClick={() => {
                      if (liveRun?.status === "running") {
                        handleStop();
                      } else {
                        void handleSend();
                      }
                    }}
                    disabled={
                      liveRun?.status !== "running" &&
                      (!composerValue.trim() || isSending || pendingFiles.some((pf) => pf.status === "uploading"))
                    }
                    aria-label={liveRun?.status === "running" ? "Stop response" : "Send message"}
                  >
                    {liveRun?.status === "running" ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                        <rect x="5.5" y="5.5" width="5" height="5" rx="0.5" fill="currentColor" />
                      </svg>
                    ) : isSending ? (
                      <div className="h-4 w-4 rounded-full border-2 border-[rgba(255,255,255,0.3)] border-t-white animate-spin" />
                    ) : (
                      <IconArrowUp />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-2 text-center text-[rgba(255,255,255,0.36)] text-[0.72rem]">
              AI can make mistakes. Please double-check responses.
            </div>
          </footer>
        </div>
      </main>

      {renamingConversation && (
        <RenameModal
          currentTitle={renamingConversation.title}
          isSaving={renameMutation.isPending}
          onClose={() => setRenamingConversation(null)}
          onSave={(title) => {
            renameMutation.mutate({ id: renamingConversation.id, title });
            setRenamingConversation(null);
          }}
        />
      )}

      {connectorModalOpen && <McpConnectorModal onClose={() => setConnectorModalOpen(false)} />}

      {secretsModalOpen && activeConversation?.repoBinding && (
        <RepoSecretsModal
          repoBindingId={activeConversation.repoBinding.id}
          repoName={activeConversation.repoBinding.repoName}
          onClose={() => setSecretsModalOpen(false)}
        />
      )}

      {repoModalOpen && (
        <RepoBindingModal
          onClose={() => setRepoModalOpen(false)}
          currentRepoBindingId={activeConversation?.repoBinding?.id ?? stagedRepoBinding?.id}
          onSelect={(binding) => {
            setRepoModalOpen(false);
            if (activeConversation) {
              linkRepoMutation.mutate({ conversationId: activeConversation.id, repoBindingId: binding.id });
            } else {
              // /chat/new — stage for later
              setStagedRepoBinding({ id: binding.id, repoFullName: binding.repoFullName });
            }
          }}
        />
      )}

      {searchModalOpen ? (
        <div
          className="fixed inset-0 z-200 flex items-start justify-center pt-[12vh] bg-[rgba(0,0,0,0.5)] backdrop-blur-[4px]"
          onClick={() => setSearchModalOpen(false)}
        >
          <div
            className="w-[min(560px,90vw)] max-h-[60vh] flex flex-col border border-[rgba(255,255,255,0.1)] rounded-[16px] bg-[rgba(28,26,22,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.5)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[rgba(255,255,255,0.08)] text-[rgba(245,240,232,0.5)]">
              <IconSearch />
              <input
                type="text"
                className="search-modal-input flex-1 border-0 bg-transparent text-[rgba(245,240,232,0.92)] text-base outline-none"
                placeholder="Search chats"
                autoFocus
                value={sidebarQuery}
                onChange={(e) => setSidebarQuery(e.target.value)}
              />
              <button
                type="button"
                className="inline-grid h-8 w-8 shrink-0 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.92)]"
                onClick={() => {
                  setSearchModalOpen(false);
                  setSidebarQuery("");
                }}
              >
                <IconClose />
              </button>
            </div>
            <div className="overflow-y-auto p-1.5">
              {filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`flex w-full items-center gap-2.5 border-0 rounded-[10px] bg-transparent text-[rgba(245,240,232,0.86)] cursor-pointer py-2.5 px-3 text-left text-[0.9rem] transition-[background] duration-[140ms] ease-linear hover:bg-[#2f2f2d] ${conversation.id === activeConversationId ? "bg-[#2f2f2d]" : ""}`}
                  onClick={() => {
                    setSearchModalOpen(false);
                    setSidebarQuery("");
                    handleSelectConversation(conversation.id);
                  }}
                >
                  <span className="flex-1 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis">
                    {conversation.title}
                  </span>
                  <span className="shrink-0 text-[0.72rem] text-[rgba(245,240,232,0.35)]">
                    {formatRelativeDate(conversation.updatedAt)}
                  </span>
                </button>
              ))}
              {filteredConversations.length === 0 ? (
                <div className="py-6 px-4 text-center text-[rgba(245,240,232,0.4)] text-[0.88rem]">No chats found</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
