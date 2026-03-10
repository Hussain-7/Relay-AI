"use client";

import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import type { AttachmentDto, ConversationDetailDto, ConversationSummaryDto, TimelineEventEnvelope } from "@/lib/contracts";
import {
  useModelCatalog,
  useConversations,
  useConversationDetail,
  useCreateConversation,
  useDeleteConversation,
  useUpdateConversationModel,
  useGithubStatus,
  usePreferences,
  queryKeys,
} from "@/lib/api-hooks";
import type { LiveRunState } from "@/lib/chat-utils";
import {
  formatModelDisplayName,
  previewText,
  normalizeApiErrorMessage,
  resizeComposer,
  landingSuggestions,
} from "@/lib/chat-utils";
import {
  IconClose,
  IconSidebarToggle,
  IconPlus,
  IconSearch,
  IconArrowUp,
  IconSpark,
  IconChevron,
  IconMore,
} from "@/components/icons";
import { SidebarMenuPortal } from "@/components/chat/sidebar-menu-portal";
import { ComposerModelMenuPortal, type AgentPreferences } from "@/components/chat/composer-model-menu";
import { AttachmentChip } from "@/components/chat/attachment-chip";
import { RunThread } from "@/components/chat/run-thread";
import { setPendingMessage, peekPendingMessage, consumePendingMessage } from "@/lib/pending-message";

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

  // Suppress detail fetch if we're about to create this conversation (pending message exists)
  const hasPendingForThis = Boolean(
    activeConversationId && peekPendingMessage()?.conversationId === activeConversationId,
  );

  // TanStack Query hooks
  const { data: catalog } = useModelCatalog();
  const { data: conversations = [], isLoading: isLoadingConversations } = useConversations();
  const { data: githubStatus } = useGithubStatus();
  const { data: activeConversation, isFetching: isFetchingDetail } = useConversationDetail(
    hasPendingForThis ? null : activeConversationId,
  );
  const isLoadingDetail = isFetchingDetail && !activeConversation;

  // Mutations
  const createMutation = useCreateConversation();
  const deleteMutation = useDeleteConversation();
  const updateModelMutation = useUpdateConversationModel();

  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<AttachmentDto[]>([]);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [liveRun, setLiveRun] = useState<LiveRunState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const { preferences: userPreferences, savePreferences } = usePreferences();
  const agentPreferences: AgentPreferences = {
    thinking: userPreferences.agent.thinking,
    effort: userPreferences.agent.effort,
    memory: userPreferences.agent.memory,
  };
  const deferredSidebarQuery = useDeferredValue(sidebarQuery);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasLandingRef = useRef(true);
  const [animateComposerDock, setAnimateComposerDock] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const storedModel = activeConversation?.mainAgentModel;
  const availableIds = catalog?.availableMainModels.map((m) => m.id);
  const isStoredModelValid = storedModel && availableIds?.includes(storedModel);
  const selectedMainModelId = (isStoredModelValid ? storedModel : null) ?? userPreferences.agent.model ?? catalog?.mainAgentModel ?? "";

  const closeMenusOnOutsidePress = useEffectEvent((event: MouseEvent) => {
    if (profileRef.current && event.target instanceof Node && !profileRef.current.contains(event.target)) {
      setProfileMenuOpen(false);
    }

    if (!(event.target instanceof Element) || !event.target.closest("[data-chat-action-menu]")) {
      setOpenConversationMenuId(null);
      setHeaderMenuOpen(false);
      setModelMenuOpen(false);
    }
  });

  useEffect(() => {
    document.addEventListener("mousedown", closeMenusOnOutsidePress);

    return () => {
      document.removeEventListener("mousedown", closeMenusOnOutsidePress);
    };
  }, []);

  useEffect(() => {
    resizeComposer(composerInputRef.current);
  }, [composerValue]);

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

  const runs = activeConversation?.runs ?? [];
  const isNewChat = !activeConversationId;
  const hasLiveContent = Boolean(liveRun);
  const isLandingState = !hasLiveContent && (isNewChat || (!isLoadingDetail && runs.length === 0));

  // Safety net: clear liveRun if the fetched runs already include it (e.g. after refetch)
  useEffect(() => {
    if (liveRun?.runId && runs.some((r) => r.id === liveRun.runId)) {
      setLiveRun(null);
    }
  }, [runs, liveRun]);

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

  // Auto-send pending message when navigating to a new chat page
  useEffect(() => {
    if (!conversationId) return;
    const pending = consumePendingMessage();
    if (pending && pending.conversationId === conversationId) {
      void startStream(conversationId, pending.prompt, pending.attachments, true);
    }
  }, [conversationId]);

  function syncScrollShadows() {
    const el = transcriptRef.current;
    const stage = stageRef.current;
    if (!el || !stage) return;

    const scrollTop = el.scrollTop;
    const scrollBottom = el.scrollHeight - el.clientHeight - scrollTop;
    stage.dataset.scrollTop = scrollTop > 8 ? "true" : "false";
    stage.dataset.scrollBottom = scrollBottom > 8 ? "true" : "false";
  }

  // Scroll to bottom when live content updates (streaming)
  useEffect(() => {
    if (!liveRun) return;
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
    syncScrollShadows();
  }, [liveRun]);

  // Instant scroll to bottom when switching conversations
  useEffect(() => {
    requestAnimationFrame(() => {
      transcriptRef.current?.scrollTo({
        top: transcriptRef.current.scrollHeight,
        behavior: "instant",
      });
      syncScrollShadows();
    });
  }, [activeConversationId]);

  useEffect(() => {
    setOpenConversationMenuId(null);
    setHeaderMenuOpen(false);
    setModelMenuOpen(false);
    setMobileSidebarOpen(false);
  }, [activeConversationId]);

  const filteredConversations = useMemo(() => {
    const query = deferredSidebarQuery.trim().toLowerCase();

    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      return (
        conversation.title.toLowerCase().includes(query) ||
        previewText(conversation.latestSnippet).toLowerCase().includes(query)
      );
    });
  }, [conversations, deferredSidebarQuery]);

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

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;

    // Need a conversation ID to upload.
    let convId = activeConversation?.id ?? activeConversationId;

    if (!convId) {
      // On /chat/new — create conversation silently (don't navigate yet)
      try {
        const newId = crypto.randomUUID();
        const created = await createMutation.mutateAsync({ id: newId });
        convId = created.id;
        // Update URL without remounting so attachments aren't lost
        window.history.replaceState(null, "", `/chat/${convId}`);
      } catch {
        setErrorMessage("Failed to create conversation for upload.");
        return;
      }
    }

    try {
      const uploaded: AttachmentDto[] = [];

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("conversationId", convId);
        formData.append("file", file);

        const response = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? "Upload failed.");
        }

        const body = (await response.json()) as { attachment: AttachmentDto };
        uploaded.push(body.attachment);
      }

      setComposerAttachments((existing) => [...existing, ...uploaded]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to upload attachment.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function updateConversationTitle(conversationId: string, title: string) {
    // Update detail cache
    queryClient.setQueryData<ConversationDetailDto>(
      queryKeys.conversation(conversationId),
      (old) => (old ? { ...old, title } : old),
    );
    // Update list cache
    queryClient.setQueryData<ConversationSummaryDto[]>(
      queryKeys.conversations,
      (old) => (old ?? []).map((c) => (c.id === conversationId ? { ...c, title } : c)),
    );
  }

  async function startStream(conversationId: string, prompt: string, attachments: AttachmentDto[], isNew: boolean) {
    setIsSending(true);
    setErrorMessage(null);
    setComposerValue("");
    setComposerAttachments([]);
    setLiveRun({
      runId: null,
      userPrompt: prompt,
      attachments,
      events: [],
      partialText: "",
      status: "running",
      error: null,
    });

    try {
      // Create the conversation in DB if this is a new chat
      if (isNew) {
        await createMutation.mutateAsync({ id: conversationId });
      }

      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          attachmentIds: attachments.map((attachment) => attachment.id),
          preferences: agentPreferences,
        }),
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({ error: "Failed to start stream." }))) as { error?: string };
        throw new Error(normalizeApiErrorMessage(body.error ?? "Failed to start stream."));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastRunId: string | null = null;
      let lastPartialText = "";
      const allEvents: TimelineEventEnvelope[] = [];
      const pendingEvents: TimelineEventEnvelope[] = [];
      let rafScheduled = false;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const segments = buffer.split("\n\n");
        buffer = segments.pop() ?? "";

        for (const segment of segments) {
          const line = segment
            .split("\n")
            .find((candidate) => candidate.startsWith("data: "));

          if (!line) {
            continue;
          }

          const event = JSON.parse(line.slice(6)) as TimelineEventEnvelope;
          allEvents.push(event);
          pendingEvents.push(event);

          if (event.type === "conversation.updated" && typeof event.payload?.title === "string") {
            updateConversationTitle(event.conversationId, event.payload.title);
          }

          // Batch state updates — flush at most once per animation frame
          if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(() => {
              rafScheduled = false;
              const batch = pendingEvents.splice(0);
              if (batch.length === 0) return;

              setLiveRun((current) => {
                if (!current) return current;

                let text = current.partialText;
                let status = current.status;
                let error = current.error;
                let runId = current.runId;

                for (const ev of batch) {
                  runId = ev.runId;
                  if (ev.type === "assistant.text.delta") {
                    text += String(ev.payload?.delta ?? "");
                  }
                  if (ev.type === "run.failed") {
                    status = "failed";
                    error = String(ev.payload?.error ?? "The agent run failed.");
                  }
                }

                lastRunId = runId;
                lastPartialText = text;

                return {
                  ...current,
                  runId,
                  partialText: text,
                  events: [...current.events, ...batch],
                  status,
                  error,
                };
              });
            });
          }
        }
      }

      // Flush any remaining batched events synchronously before transitioning
      if (pendingEvents.length > 0) {
        const batch = pendingEvents.splice(0);
        setLiveRun((current) => {
          if (!current) return current;
          let text = current.partialText;
          let status = current.status;
          let error = current.error;
          let runId = current.runId;
          for (const ev of batch) {
            runId = ev.runId;
            if (ev.type === "assistant.text.delta") {
              text += String(ev.payload?.delta ?? "");
            }
            if (ev.type === "run.failed") {
              status = "failed";
              error = String(ev.payload?.error ?? "The agent run failed.");
            }
          }
          lastRunId = runId;
          lastPartialText = text;
          return { ...current, runId, partialText: text, events: [...current.events, ...batch], status, error };
        });
      }

      // Phase 5: Post-stream cache patch instead of refreshConversation()
      if (lastRunId) {
        const completedEvent = allEvents.find((e) => e.type === "run.completed");
        const finalText = lastPartialText;
        const now = new Date().toISOString();

        // Patch detail cache — append the completed run
        queryClient.setQueryData<ConversationDetailDto>(
          queryKeys.conversation(conversationId),
          (old) => {
            if (!old) return old;

            const newRun = {
              id: lastRunId!,
              status: completedEvent ? ("COMPLETED" as const) : ("FAILED" as const),
              userPrompt: prompt,
              finalText,
              metadataJson: null,
              createdAt: now,
              updatedAt: now,
              completedAt: completedEvent ? now : null,
              cancelledAt: null,
              attachments: attachments,
              approvals: [],
              events: allEvents.filter((e) => e.runId === lastRunId),
              codingSession: null,
            };

            return {
              ...old,
              updatedAt: now,
              runs: [...old.runs, newRun],
            };
          },
        );

        // Patch list cache — update snippet and timestamp
        queryClient.setQueryData<ConversationSummaryDto[]>(
          queryKeys.conversations,
          (old) =>
            (old ?? []).map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    updatedAt: now,
                    latestSnippet: finalText || prompt,
                    latestRunStatus: completedEvent ? ("COMPLETED" as const) : ("FAILED" as const),
                  }
                : c,
            ),
        );

        // Clear liveRun immediately — the cache patch above ensures no DOM gap
        setLiveRun(null);

        // Background refetch for eventual server truth (don't refetch immediately
        // to avoid overwriting the optimistic patch before the server has persisted)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversation(conversationId),
          refetchType: "none",
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversations,
          refetchType: "none",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? normalizeApiErrorMessage(error.message) : "Failed to send prompt.";
      setErrorMessage(message);
      setLiveRun((current) =>
        current
          ? {
              ...current,
              status: "failed",
              error: message,
              events: current.events.some((event) => event.type === "run.failed")
                ? current.events
                : [
                    ...current.events,
                    {
                      id: `client-run-failed-${Date.now()}`,
                      runId: current.runId ?? "pending",
                      conversationId,
                      type: "run.failed",
                      source: "system",
                      ts: new Date().toISOString(),
                      payload: {
                        error: message,
                      },
                    },
                  ],
            }
          : current,
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleSend() {
    if (!composerValue.trim() || isSending) return;

    const prompt = composerValue.trim();
    const attachments = composerAttachments;

    if (activeConversation) {
      // Existing chat — stream directly
      void startStream(activeConversation.id, prompt, attachments, false);
    } else {
      // New chat — generate UUID, store pending message, navigate instantly
      const newId = crypto.randomUUID();
      setPendingMessage({ conversationId: newId, prompt, attachments });
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
          "sidebar-panel relative flex min-h-0 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(37,35,31,0.96),rgba(28,27,24,0.96)),radial-gradient(circle_at_24%_8%,rgba(255,255,255,0.035),transparent_42%)] backdrop-blur-[24px] overflow-hidden transition-[padding] duration-[260ms] [transition-timing-function:cubic-bezier(0.2,0.9,0.2,1)] z-20",
          showCollapsedSidebar ? "py-3.5 px-0 items-center gap-1" : "pt-4 px-3 pb-3",
          isMobileViewport && mobileSidebarOpen ? "sidebar-panel-mobile-open" : "",
        ].join(" ")}
      >
        {showCollapsedSidebar ? (
          <>
            <div className="flex flex-1 flex-col items-center gap-1">
              <button type="button" className="inline-grid h-10 w-10 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.92)] mb-3" aria-label="Expand sidebar" onClick={() => setSidebarCollapsed(false)}>
                <IconSidebarToggle />
              </button>
              <button type="button" className="inline-grid h-10 w-10 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.92)]" aria-label="New chat" onClick={handleCreateConversation}>
                <IconPlus />
              </button>
              <button type="button" className="inline-grid h-10 w-10 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.92)]" aria-label="Search chats" onClick={() => setSearchModalOpen(true)}>
                <IconSearch />
              </button>
            </div>
            <div className="w-9 h-9 rounded-full bg-[rgba(245,240,232,0.12)] text-[rgba(245,240,232,0.88)] grid place-items-center text-[0.72rem] font-semibold cursor-pointer transition-[background] duration-[180ms] ease-linear hover:bg-[rgba(245,240,232,0.2)]" role="button" tabIndex={0} onClick={() => setSidebarCollapsed(false)}>
              N
            </div>
          </>
        ) : (
          <>
        <div className="flex items-center justify-between px-1 pt-0.5 mb-4">
          <div className="font-serif text-[1.35rem] font-bold leading-none tracking-[-0.03em] text-[rgba(247,242,233,0.96)]">Relay AI</div>
          {isMobileViewport ? (
            <button type="button" className="inline-grid h-[34px] w-[34px] place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[8px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.92)]" aria-label="Close sidebar" onClick={() => setMobileSidebarOpen(false)}>
              <IconClose />
            </button>
          ) : (
            <button type="button" className="inline-grid h-[34px] w-[34px] place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[8px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.92)]" aria-label="Collapse sidebar" onClick={() => setSidebarCollapsed(true)}>
              <IconSidebarToggle />
            </button>
          )}
        </div>

        <button type="button" className="group flex items-center gap-3 w-full border-0 rounded-[10px] bg-transparent text-[rgba(236,230,219,0.82)] cursor-pointer py-[9px] px-2.5 text-left text-[0.9rem] leading-[1.25] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.96)]" onClick={handleCreateConversation}>
          <span className="inline-grid shrink-0 w-5 h-5 place-items-center text-[rgba(236,230,219,0.72)] group-hover:text-[rgba(247,242,233,0.92)]"><IconPlus /></span>
          <span>New chat</span>
        </button>

        <button type="button" className="group flex items-center gap-3 w-full border-0 rounded-[10px] bg-transparent text-[rgba(236,230,219,0.82)] cursor-pointer py-[9px] px-2.5 text-left text-[0.9rem] leading-[1.25] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.96)]" onClick={() => setSearchModalOpen(true)}>
          <span className="inline-grid shrink-0 w-5 h-5 place-items-center text-[rgba(236,230,219,0.72)] group-hover:text-[rgba(247,242,233,0.92)]"><IconSearch /></span>
          <span>Search</span>
        </button>

        <div className="text-[0.68rem] uppercase tracking-[0.1em] text-[rgba(236,230,219,0.38)] pt-3.5 px-2.5 pb-1.5">Chats</div>
        <div className="sidebar-conversation-list flex flex-1 min-h-0 flex-col gap-px overflow-y-auto overflow-x-hidden -mx-1 px-1">
          {isLoadingConversations ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex w-full items-center py-[9px] px-2.5">
                <div className="h-[18px] rounded-[6px] bg-[rgba(255,255,255,0.06)] animate-pulse" style={{ width: `${50 + (i % 3) * 20}%` }} />
              </div>
            ))
          ) : filteredConversations.map((conversation) => {
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
                  className={`flex w-full items-center border-0 rounded-[10px] bg-transparent text-inherit cursor-pointer py-[9px] pr-[34px] pl-2.5 text-left transition-[background] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.05)] ${isActive ? "bg-[rgba(255,255,255,0.06)]" : ""}`}
                  onClick={() => handleSelectConversation(conversation.id)}
                >
                  <div className={`text-[0.88rem] font-[420] text-[rgba(242,237,229,0.82)] whitespace-nowrap overflow-hidden text-ellipsis ${isActive ? "text-[rgba(247,242,233,0.96)]" : "group-hover/row:text-[rgba(247,242,233,0.96)]"}`}>{conversation.title}</div>
                </button>

                <div className="absolute top-1/2 right-1 -translate-y-1/2" data-chat-action-menu>
                  <button
                    type="button"
                    className={`inline-grid h-[26px] w-[26px] place-items-center border-0 bg-transparent rounded-[6px] text-[rgba(245,240,232,0.46)] cursor-pointer transition-[opacity,color,background] duration-[140ms] ease-linear hover:text-[rgba(245,240,232,0.88)] hover:bg-[rgba(255,255,255,0.08)] ${isMenuOpen || isActive ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}
                    aria-label={`Open menu for ${conversation.title}`}
                    aria-expanded={isMenuOpen}
                    data-conversation-menu={conversation.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setHeaderMenuOpen(false);
                      setOpenConversationMenuId((current) => (current === conversation.id ? null : conversation.id));
                    }}
                  >
                    <IconMore />
                  </button>

                  {isMenuOpen ? (
                    <SidebarMenuPortal
                      triggerSelector={`[data-conversation-menu="${conversation.id}"]`}
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
        </div>

        <div className="relative mt-auto pt-2 border-t border-[rgba(255,255,255,0.06)]" ref={profileRef}>
          <button
            type="button"
            className="grid w-full grid-cols-[36px_1fr_16px] items-center gap-2.5 border-0 rounded-[10px] bg-transparent text-inherit cursor-pointer py-2.5 px-2 text-left transition-[background] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)]"
            onClick={() => setProfileMenuOpen((current) => !current)}
          >
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[rgba(237,233,225,0.12)] text-[0.72rem] font-semibold">N</div>
            <div className="min-w-0">
              <div className="text-[0.88rem] text-[rgba(245,240,232,0.88)]">Demo account</div>
              <div className="text-[0.72rem] text-[rgba(236,230,219,0.44)]">Local development mode</div>
            </div>
            <span className="inline-grid place-items-center text-[rgba(236,230,219,0.36)]"><IconChevron /></span>
          </button>

          {profileMenuOpen ? (
            <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 border border-[rgba(255,255,255,0.12)] rounded-[16px] bg-[linear-gradient(180deg,rgba(63,61,56,0.96),rgba(53,51,47,0.96))] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.34)] backdrop-blur-[18px]">
              <div className="flex justify-between gap-3 py-[7px] px-1 text-muted text-[0.8rem]">
                <span>Model</span>
                <strong className="text-foreground font-medium">{formatModelDisplayName(catalog?.mainAgentModel) ?? "Loading"}</strong>
              </div>
              <div className="flex justify-between gap-3 py-[7px] px-1 text-muted text-[0.8rem]">
                <span>Tools</span>
                <strong className="text-foreground font-medium">{catalog?.builtInTools.filter((tool) => tool.enabled).length ?? 0}</strong>
              </div>
              <div className="flex justify-between items-center gap-3 py-[7px] px-1 text-muted text-[0.8rem]">
                <span className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                  GitHub
                </span>
                {githubStatus?.installed ? (
                  <span className="text-[rgba(122,168,148,0.9)] font-medium">Connected</span>
                ) : githubStatus?.configured ? (
                  <a
                    href={githubStatus.installUrl ?? "/api/github/install"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[rgba(212,112,73,0.9)] font-medium no-underline hover:text-[rgba(212,112,73,1)]"
                    onClick={() => {
                      // Start polling for installation status every 3s
                      const interval = setInterval(() => {
                        void queryClient.invalidateQueries({ queryKey: queryKeys.githubStatus });
                      }, 3000);
                      // Stop after 2 minutes
                      setTimeout(() => clearInterval(interval), 120_000);
                    }}
                  >
                    Connect
                  </a>
                ) : (
                  <span className="text-[rgba(245,240,232,0.38)] font-medium">Not configured</span>
                )}
              </div>
            </div>
          ) : null}
        </div>
          </>
        )}
      </aside>

      <main className="grid min-h-0 h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden min-w-0 max-[980px]:h-dvh max-[980px]:min-h-dvh max-[980px]:w-full max-[980px]:max-w-full">
        <header className="flex items-center justify-start gap-[18px] pt-3.5 px-[30px] pb-2 max-[980px]:gap-2 max-[980px]:pt-3 max-[980px]:pb-1 max-[980px]:px-[18px]">
          <div className="flex min-w-0 w-full items-center gap-0 max-[980px]:w-full max-[980px]:gap-2">
            {isMobileViewport ? (
              <button
                type="button"
                className="hidden max-[980px]:inline-grid h-10 w-10 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-140 ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.92)] shrink-0"
                aria-label={mobileSidebarOpen ? "Close navigation" : "Open navigation"}
                aria-expanded={mobileSidebarOpen}
                onClick={() => setMobileSidebarOpen((current) => !current)}
              >
                <IconSidebarToggle />
              </button>
            ) : null}

            {activeConversation ? (
              <div className="relative min-w-0 max-w-full max-[980px]:flex-auto max-[980px]:min-w-0 max-[980px]:max-w-[calc(100%-48px)]" data-chat-action-menu>
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 w-auto max-w-[min(100%,42rem)] min-w-0 border-0 rounded-[10px] bg-transparent text-[rgba(235,230,220,0.82)] cursor-pointer py-1.5 px-2.5 overflow-hidden transition-[color,background] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(245,240,232,0.96)] max-[980px]:max-w-full max-[980px]:border-0 max-[980px]:rounded-none max-[980px]:bg-transparent max-[980px]:p-0`}
                  aria-label={`Open menu for ${activeConversation.title}`}
                  aria-expanded={headerMenuOpen}
                  onClick={() => {
                    setOpenConversationMenuId(null);
                    setHeaderMenuOpen((current) => !current);
                  }}
                >
                  <span className="min-w-0 flex-[0_1_auto] p-0 text-[0.96rem] font-[430] leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis max-[980px]:text-[0.92rem] max-[980px]:p-0 max-[980px]:whitespace-nowrap">{activeConversation.title}</span>
                  <span className="hidden" aria-hidden="true" />
                  <span className={`inline-grid w-auto place-items-center text-[rgba(245,240,232,0.54)] transition-[transform,color] duration-[180ms] ease-linear max-[980px]:w-auto ${headerMenuOpen ? "rotate-180 text-[rgba(245,240,232,0.9)]" : ""}`} aria-hidden="true">
                    <IconChevron />
                  </span>
                </button>

                {headerMenuOpen ? (
                  <div className="absolute top-[calc(100%+6px)] left-0 min-w-[180px] z-10 border border-[rgba(255,255,255,0.1)] rounded-[12px] bg-[rgba(42,40,36,0.98)] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-[18px]">
                    <button
                      type="button"
                      className="chat-action-menu-item chat-action-menu-item-danger flex w-full items-center justify-start border-0 rounded-[8px] bg-transparent text-[#f2c4b2] cursor-pointer px-3 py-2 text-left text-[0.88rem] leading-[1.2] transition-[background,color] duration-[140ms] ease-linear"
                      onClick={() => {
                        void handleDeleteConversation(activeConversation.id);
                      }}
                      disabled={deletingConversationId === activeConversation.id}
                    >
                      {deletingConversationId === activeConversation.id ? "Deleting\u2026" : "Delete chat"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="min-w-0 flex-[0_1_auto] py-1.5 px-2.5 text-[0.96rem] font-[430] leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis" style={{ opacity: 0.4 }}>New chat</div>
            )}
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
                  <div className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.07)] animate-pulse" style={{ width: "82%" }} />
                  <div className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.06)] animate-pulse" style={{ width: "95%" }} />
                  <div className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.07)] animate-pulse" style={{ width: "88%" }} />
                  <div className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.06)] animate-pulse" style={{ width: "74%" }} />
                  <div className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.07)] animate-pulse" style={{ width: "91%" }} />
                  <div className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.06)] animate-pulse" style={{ width: "80%" }} />
                  <div className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.05)] animate-pulse" style={{ width: "65%" }} />
                  <div className="h-[13px] rounded-[4px] bg-[rgba(255,255,255,0.06)] animate-pulse" style={{ width: "72%" }} />
                </div>
                <div className="h-[13px] w-[120px] rounded-[4px] bg-[rgba(255,255,255,0.04)] animate-pulse mt-4" />
              </div>
            </div>
          ) : isLandingState ? (
            <section className="chat-landing flex h-full flex-col items-center justify-center gap-4 pt-9 px-[30px] pb-[280px] text-center overflow-hidden max-[980px]:justify-end max-[980px]:px-[18px] max-[980px]:pt-6 max-[980px]:pb-[200px] max-[980px]:gap-3.5">
              {errorMessage ? <div className="max-w-[720px] mx-auto mb-[18px] border border-[rgba(181,103,69,0.3)] rounded-[18px] bg-[rgba(181,103,69,0.12)] text-[#f3c7b4] px-4 py-3.5">{errorMessage}</div> : null}
              <div className="inline-flex items-center justify-center rounded-full bg-[rgba(10,10,10,0.42)] text-[rgba(245,240,232,0.64)] py-2.5 px-4 text-[0.82rem] tracking-[0.12em] uppercase max-[980px]:text-[0.72rem] max-[980px]:py-[7px] max-[980px]:px-3">AI chat</div>
              <div className="flex items-center gap-3.5 max-[980px]:flex-col max-[980px]:gap-2">
                <span className="inline-grid h-[42px] w-[42px] place-items-center text-[#cf6d43] max-[980px]:h-7 max-[980px]:w-7">
                  <IconSpark />
                </span>
                <h1 className="m-0 font-serif text-[clamp(2rem,4vw,4.2rem)] leading-[0.94] tracking-[-0.04em]">What shall we think through?</h1>
              </div>
              <p className="max-w-[58rem] m-0 text-[rgba(245,240,232,0.6)] text-base leading-[1.7] max-[980px]:text-[0.88rem] max-[980px]:leading-[1.55]">
                Ask questions, upload files, research ideas, and move from planning to execution in one conversation.
              </p>
              <div className="flex flex-wrap justify-center gap-2.5 max-[980px]:gap-1.5" aria-label="Suggested prompts">
                {landingSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="border border-[rgba(255,255,255,0.08)] rounded-full bg-[rgba(255,255,255,0.03)] text-[rgba(245,240,232,0.7)] py-2.5 px-3.5 text-[0.86rem] cursor-pointer transition-[background,border-color,color,transform] duration-[180ms] ease-linear hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.14)] hover:text-[rgba(245,240,232,0.94)] hover:-translate-y-px max-[980px]:text-[0.78rem] max-[980px]:py-2 max-[980px]:px-3"
                    onClick={() => {
                      setComposerValue(suggestion);
                      window.requestAnimationFrame(() => {
                        composerInputRef.current?.focus();
                        resizeComposer(composerInputRef.current);
                      });
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="h-full overflow-y-auto overflow-x-hidden overscroll-contain pt-2 px-[30px] pb-[236px] min-w-0 max-[980px]:px-[18px] max-[980px]:w-full max-[980px]:max-w-full max-[980px]:pb-[180px]" ref={transcriptRef} onScroll={syncScrollShadows}>
              <div className="chat-transcript-inner min-h-0 min-w-0">
                {errorMessage ? <div className="max-w-[860px] mx-auto mb-[18px] border border-[rgba(181,103,69,0.3)] rounded-[18px] bg-[rgba(181,103,69,0.12)] text-[#f3c7b4] px-4 py-3.5">{errorMessage}</div> : null}

                {runs.map((run, index) => (
                  <RunThread
                    key={run.id}
                    userPrompt={run.userPrompt}
                    attachments={run.attachments}
                    events={run.events}
                    finalText={run.finalText}
                    createdAt={run.createdAt}
                    isLast={index === runs.length - 1 && !liveRun}
                  />
                ))}

                {liveRun && !runs.some((r) => r.id === liveRun.runId) ? (
                  <RunThread
                    userPrompt={liveRun.userPrompt}
                    attachments={liveRun.attachments}
                    events={liveRun.events}
                    finalText={liveRun.partialText || null}
                    createdAt={new Date().toISOString()}
                    isLive
                  />
                ) : null}
              </div>
            </div>
          )}

        <footer
          className={[
            "absolute left-0 right-0 z-3 bg-[linear-gradient(180deg,rgba(26,25,23,0)_0%,rgba(26,25,23,0.74)_22%,rgba(26,25,23,0.97)_100%)] backdrop-blur-[16px] transition-[transform,opacity] duration-[420ms] [transition-timing-function:cubic-bezier(0.2,0.9,0.2,1)]",
            isLandingState && isNewChat
              ? "bottom-1/2 px-[30px] translate-y-[182px] bg-none backdrop-blur-none max-[980px]:bottom-0 max-[980px]:pb-3 max-[980px]:translate-y-0 max-[980px]:px-[18px]"
              : "bottom-0 px-[30px] pb-[26px] max-[980px]:px-[18px] max-[980px]:pb-3",
            animateComposerDock ? "composer-panel-animate-dock" : "",
          ].join(" ")}
        >
          <div
            className={`composer-shell flex max-w-[980px] w-full min-w-0 min-h-[120px] flex-col gap-3.5 mx-auto border rounded-[26px] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02)),rgba(54,52,47,0.84)] pt-[18px] px-[22px] pb-4 shadow-[0_4px_16px_rgba(0,0,0,0.12)] max-[980px]:w-full max-[980px]:max-w-full max-[980px]:m-0 max-[980px]:min-h-0 max-[980px]:gap-2.5 max-[980px]:pt-3.5 max-[980px]:px-4 max-[980px]:pb-3 max-[980px]:rounded-[20px] transition-[border-color] duration-150 ${isDraggingOver ? "border-[rgba(212,112,73,0.6)]" : "border-[rgba(255,255,255,0.08)]"}`}
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
            {composerAttachments.length ? (
              <div className="flex flex-wrap gap-2 mb-2">
                {composerAttachments.map((attachment) => (
                  <AttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={() => setComposerAttachments((prev) => prev.filter((a) => a.id !== attachment.id))}
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
                className="inline-grid h-9 w-9 place-items-center rounded-full border-0 bg-transparent text-[rgba(255,255,255,0.7)] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.92)]"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload a file"
              >
                <IconPlus />
              </button>

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
                  className="inline-grid h-[54px] w-[54px] place-items-center rounded-[16px] border-0 bg-[#d47049] text-[#fff8f0] cursor-pointer shadow-[0_10px_24px_rgba(207,109,67,0.3)] transition-[transform,background,opacity] duration-[180ms] ease-linear hover:not-disabled:-translate-y-px hover:not-disabled:bg-[#dd7851] disabled:opacity-50 disabled:cursor-not-allowed max-[980px]:h-[42px] max-[980px]:w-[42px] max-[980px]:rounded-[12px]"
                  onClick={() => {
                    void handleSend();
                  }}
                  disabled={!composerValue.trim() || isSending}
                  aria-label={isSending ? "Streaming response" : "Send message"}
                >
                  <IconArrowUp />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-2.5 text-center text-[rgba(255,255,255,0.46)] text-[0.78rem]">AI can make mistakes. Please double-check responses.</div>
        </footer>
        </div>
      </main>

      {searchModalOpen ? (
        <div className="fixed inset-0 z-200 flex items-start justify-center pt-[12vh] bg-[rgba(0,0,0,0.5)] backdrop-blur-[4px]" onClick={() => setSearchModalOpen(false)}>
          <div className="w-[min(560px,90vw)] max-h-[60vh] flex flex-col border border-[rgba(255,255,255,0.1)] rounded-[16px] bg-[rgba(28,26,22,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.5)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
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
              <button type="button" className="inline-grid h-8 w-8 shrink-0 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.92)]" onClick={() => { setSearchModalOpen(false); setSidebarQuery(""); }}>
                <IconClose />
              </button>
            </div>
            <div className="overflow-y-auto p-1.5">
              {filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`flex w-full items-center gap-2.5 border-0 rounded-[10px] bg-transparent text-[rgba(245,240,232,0.86)] cursor-pointer py-2.5 px-3 text-left text-[0.9rem] transition-[background] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.06)] ${conversation.id === activeConversationId ? "bg-[rgba(255,255,255,0.08)]" : ""}`}
                  onClick={() => {
                    setSearchModalOpen(false);
                    setSidebarQuery("");
                    handleSelectConversation(conversation.id);
                  }}
                >
                  <span className="overflow-hidden whitespace-nowrap text-ellipsis">{conversation.title}</span>
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
