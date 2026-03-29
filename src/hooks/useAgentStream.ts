import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { AgentPreferences } from "@/components/chat/composer-model-menu";
import { api } from "@/lib/api-client";
import { queryKeys, useCreateConversation, useLinkRepoToConversation } from "@/lib/api-hooks";
import type { LiveRunState } from "@/lib/chat-utils";
import { normalizeApiErrorMessage } from "@/lib/chat-utils";
import type {
  AttachmentDto,
  ConversationDetailDto,
  ConversationSummaryDto,
  RunDto,
  TimelineEventEnvelope,
} from "@/lib/contracts";

interface UseAgentStreamParams {
  agentPreferences: AgentPreferences;
}

export function useAgentStream({ agentPreferences }: UseAgentStreamParams) {
  const queryClient = useQueryClient();
  const createMutation = useCreateConversation();
  const linkRepoMutation = useLinkRepoToConversation();

  const liveRunRef = useRef(false);
  const streamStartedForRef = useRef<string | null>(null);
  const previewUrlMapRef = useRef<Map<string, string>>(new Map());

  const [liveRun, setLiveRunState] = useState<LiveRunState | null>(null);
  // Keep ref in sync for hasPendingForThis (avoids declaration-order issues).
  // Only suppress detail fetch while the run is actively running — once completed/failed,
  // allow the fetch so `runs` populates and the liveRun can be cleared.
  liveRunRef.current = liveRun !== null && liveRun.status === "running";
  const setLiveRun = (v: LiveRunState | null | ((prev: LiveRunState | null) => LiveRunState | null)) => {
    setLiveRunState(v);
  };

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  function updateConversationTitle(conversationId: string, title: string) {
    // Update detail cache
    queryClient.setQueryData<ConversationDetailDto>(queryKeys.conversation(conversationId), (old) =>
      old ? { ...old, title } : old,
    );
    // Update list cache
    queryClient.setQueryData<ConversationSummaryDto[]>(queryKeys.conversations, (old) =>
      (old ?? []).map((c) => (c.id === conversationId ? { ...c, title } : c)),
    );
  }

  async function startStream(
    conversationId: string,
    prompt: string,
    attachments: AttachmentDto[],
    isNew: boolean,
    opts?: {
      stagedFiles?: Array<{ clientId: string; file: File; previewUrl: string | null }>;
      stagedRepoBindingId?: string | null;
    },
  ) {
    setIsSending(true);
    setErrorMessage(null);
    // Mark this conversation so the cleanup effect skips revocation (survives Strict Mode re-runs)
    streamStartedForRef.current = conversationId;
    // NOTE: preview URLs are NOT revoked here — the run thread still needs them.
    // They are revoked on navigation (activeConversationId effect).
    // NOTE: stagedRepoBinding is NOT cleared here — it bridges the gap until
    // activeConversation.repoBinding is populated by the link mutation.
    // Build placeholder AttachmentDtos from staged files so chips show immediately
    // (before the upload round-trip completes). They'll be replaced with real ones after upload.
    const placeholderAttachments: AttachmentDto[] = (opts?.stagedFiles ?? []).map((sf) => {
      const mt = sf.file.type || "application/octet-stream";
      const kind: AttachmentDto["kind"] = mt.startsWith("image/")
        ? "IMAGE"
        : mt === "application/pdf"
          ? "PDF"
          : "OTHER";
      return {
        id: sf.clientId,
        kind,
        filename: sf.file.name,
        mediaType: mt,
        sizeBytes: sf.file.size,
        anthropicFileId: null,
        createdAt: new Date().toISOString(),
        metadataJson: sf.previewUrl ? { localPreviewUrl: sf.previewUrl } : null,
      };
    });
    // Seed previewUrlMap with placeholder IDs so image thumbnails render during upload
    for (const sf of opts?.stagedFiles ?? []) {
      if (sf.previewUrl) {
        previewUrlMapRef.current.set(sf.clientId, sf.previewUrl);
      }
    }
    setLiveRun({
      runId: null,
      userPrompt: prompt,
      attachments: [...attachments, ...placeholderAttachments],
      outputAttachments: [],
      events: [],
      partialText: "",
      status: "running",
      error: null,
    });

    try {
      // Create the conversation in DB if this is a new chat (atomically with repo binding)
      if (isNew) {
        await createMutation.mutateAsync({
          id: conversationId,
          repoBindingId: opts?.stagedRepoBindingId ?? undefined,
        });
      } else if (opts?.stagedRepoBindingId) {
        // Existing conversation — link repo binding separately
        await linkRepoMutation.mutateAsync({ conversationId, repoBindingId: opts.stagedRepoBindingId });
      }

      // Upload staged files now that conversation exists
      let uploadedAttachments: AttachmentDto[] = [];
      if (opts?.stagedFiles?.length) {
        const stagedCount = opts.stagedFiles.length;
        const results = await Promise.allSettled(
          opts.stagedFiles.map(async (sf) => {
            const formData = new FormData();
            formData.append("conversationId", conversationId);
            formData.append("file", sf.file);
            const body = await api.upload<{ attachment: AttachmentDto }>("/api/uploads", formData);
            if (sf.previewUrl) {
              previewUrlMapRef.current.set(body.attachment.id, sf.previewUrl);
            }
            return body.attachment;
          }),
        );
        uploadedAttachments = results
          .filter((r): r is PromiseFulfilledResult<AttachmentDto> => r.status === "fulfilled")
          .map((r) => r.value);

        if (uploadedAttachments.length === 0 && stagedCount > 0) {
          throw new Error("All file uploads failed.");
        }
      }

      const allAttachments = [...attachments, ...uploadedAttachments];

      // Update the live run to include the uploaded attachments
      if (uploadedAttachments.length > 0) {
        setLiveRun((prev) => (prev ? { ...prev, attachments: allAttachments } : prev));
      }

      const response = await api.stream(`/api/conversations/${conversationId}/messages`, {
        prompt,
        attachmentIds: allAttachments.map((attachment) => attachment.id),
        preferences: agentPreferences,
        ...(isNew ? { isNew: true } : {}),
      });

      const reader = response.body!.getReader();
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
          const line = segment.split("\n").find((candidate) => candidate.startsWith("data: "));

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
                let newOutputAttachments: AttachmentDto[] | null = null;
                const extraEvents: TimelineEventEnvelope[] = [];

                for (const ev of batch) {
                  runId = ev.runId;
                  // When a tool call starts and we have accumulated text,
                  // flush it as an intermediate text timeline entry
                  if (ev.type === "tool.call.started" && text.trim()) {
                    extraEvents.push({
                      id: `intermediate-${ev.id}`,
                      runId: ev.runId,
                      conversationId: ev.conversationId,
                      type: "assistant.text.intermediate",
                      source: "main_agent",
                      ts: ev.ts,
                      payload: { text: text.trim() },
                    });
                    text = "";
                  }
                  if (ev.type === "assistant.text.delta") {
                    text += String(ev.payload?.delta ?? "");
                  }
                  if (ev.type === "assistant.message.completed" && typeof ev.payload?.text === "string") {
                    text = ev.payload.text;
                    if (Array.isArray(ev.payload.outputAttachments)) {
                      newOutputAttachments = ev.payload.outputAttachments as AttachmentDto[];
                    }
                  }
                  if (ev.type === "run.failed") {
                    status = "failed";
                    error = String(ev.payload?.error ?? "The agent run failed.");
                  }
                  if (ev.type === "run.cancelled") {
                    status = "interrupted";
                  }
                }

                lastRunId = runId;
                lastPartialText = text;

                // Only store events needed for timeline rendering (skip text deltas)
                const timelineEvents = [
                  ...extraEvents,
                  ...batch.filter(
                    (ev) => ev.type !== "assistant.text.delta" && ev.type !== "assistant.thinking.completed",
                  ),
                ];

                return {
                  ...current,
                  runId,
                  partialText: text,
                  events: timelineEvents.length > 0 ? [...current.events, ...timelineEvents] : current.events,
                  ...(newOutputAttachments ? { outputAttachments: newOutputAttachments } : {}),
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
          let newOutputAttachments: AttachmentDto[] | null = null;
          const extraEvents: TimelineEventEnvelope[] = [];
          for (const ev of batch) {
            runId = ev.runId;
            if (ev.type === "tool.call.started" && text.trim()) {
              extraEvents.push({
                id: `intermediate-${ev.id}`,
                runId: ev.runId,
                conversationId: ev.conversationId,
                type: "assistant.text.intermediate",
                source: "main_agent",
                ts: ev.ts,
                payload: { text: text.trim() },
              });
              text = "";
            }
            if (ev.type === "assistant.text.delta") {
              text += String(ev.payload?.delta ?? "");
            }
            if (ev.type === "assistant.message.completed" && typeof ev.payload?.text === "string") {
              text = ev.payload.text;
              if (Array.isArray(ev.payload.outputAttachments)) {
                newOutputAttachments = ev.payload.outputAttachments as AttachmentDto[];
              }
            }
            if (ev.type === "run.failed") {
              status = "failed";
              error = String(ev.payload?.error ?? "The agent run failed.");
            }
            if (ev.type === "run.cancelled") {
              status = "interrupted";
            }
          }
          lastRunId = runId;
          lastPartialText = text;
          const timelineEvents = [
            ...extraEvents,
            ...batch.filter((ev) => ev.type !== "assistant.text.delta" && ev.type !== "assistant.thinking.completed"),
          ];
          return {
            ...current,
            runId,
            partialText: text,
            events: timelineEvents.length > 0 ? [...current.events, ...timelineEvents] : current.events,
            ...(newOutputAttachments ? { outputAttachments: newOutputAttachments } : {}),
            status,
            error,
          };
        });
      }

      // Phase 5: Post-stream cache patch instead of refreshConversation()
      if (lastRunId) {
        const completedEvent = allEvents.find((e) => e.type === "run.completed");
        const cancelledEvent = allEvents.find((e) => e.type === "run.cancelled");
        const finalText = lastPartialText;
        const now = new Date().toISOString();

        const runStatus = completedEvent
          ? ("COMPLETED" as const)
          : cancelledEvent
            ? ("CANCELLED" as const)
            : ("FAILED" as const);

        // Patch detail cache — append the completed run
        queryClient.setQueryData<ConversationDetailDto>(queryKeys.conversation(conversationId), (old) => {
          if (!old) return old;

          // Extract output attachments from the completed event payload
          const completedMsgEvent = allEvents.find((e) => e.type === "assistant.message.completed");
          const patchOutputAttachments = Array.isArray(completedMsgEvent?.payload?.outputAttachments)
            ? (completedMsgEvent.payload.outputAttachments as AttachmentDto[])
            : [];

          const newRun: RunDto = {
            id: lastRunId!,
            status: runStatus,
            userPrompt: prompt,
            finalText,
            metadataJson: cancelledEvent ? { cancelled: true } : null,
            createdAt: now,
            updatedAt: now,
            completedAt: completedEvent || cancelledEvent ? now : null,
            cancelledAt: cancelledEvent ? now : null,
            attachments: allAttachments,
            outputAttachments: patchOutputAttachments,
            approvals: [],
            events: allEvents.filter((e) => e.runId === lastRunId),
            codingSession: null,
          };

          // Replace the run if it already exists (background refetch may have added it
          // while still RUNNING), otherwise append.
          const existingIndex = old.runs.findIndex((r) => r.id === newRun.id);
          const updatedRuns =
            existingIndex >= 0 ? old.runs.map((r) => (r.id === newRun.id ? newRun : r)) : [...old.runs, newRun];

          return {
            ...old,
            updatedAt: now,
            runs: updatedRuns,
          };
        });

        // Patch list cache — update snippet and timestamp
        queryClient.setQueryData<ConversationSummaryDto[]>(queryKeys.conversations, (old) =>
          (old ?? []).map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  updatedAt: now,
                  latestSnippet: finalText || prompt,
                  latestRunStatus: runStatus,
                }
              : c,
          ),
        );

        // Mark liveRun as completed (stops cursor/spinner) but keep it rendered.
        setLiveRun((prev) => (prev ? { ...prev, status: "completed" } : prev));

        // Mark the conversations list stale for next navigation.
        // NOTE: Do NOT invalidate the detail query here — the cache was just patched
        // with the completed run. Invalidating would trigger a background refetch when
        // the detail query re-enables (hasPendingForThis goes false), and if the server
        // hasn't persisted the run yet, the refetch overwrites the patch and the run
        // disappears. staleTime (30s) handles natural refresh on subsequent navigations.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversations,
          refetchType: "none",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? normalizeApiErrorMessage(error.message) : "Failed to send prompt.";
      // Show error inline in the run response, not as a top banner
      setLiveRun((current) =>
        current
          ? {
              ...current,
              status: "failed",
              error: message,
              partialText: current.partialText || `Something went wrong: ${message}`,
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

  async function handleStop() {
    const runId = liveRun?.runId;
    if (!runId) return;
    await api.post(`/api/agent/runs/${runId}/stop`).catch(() => {});
  }

  return {
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
    createMutation,
    linkRepoMutation,
  };
}
