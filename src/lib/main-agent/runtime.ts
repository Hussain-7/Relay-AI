import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaRawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Prisma, RunStatus } from "@prisma/client";

import { type TimelineEventEnvelope } from "@/lib/contracts";
import { env, hasAnthropicApiKey } from "@/lib/env";
import { getConfiguredMcpServers } from "@/lib/main-agent/mcp";
import { buildMainAgentSystemPrompt } from "@/lib/main-agent/system-prompt";
import { MAIN_AGENT_SERVER_TOOLS, getMainAgentTools } from "@/lib/main-agent/tools";
import { createMemoryTool, createMemorySearchTool, createMemoryWriteTool } from "@/lib/main-agent/tools/memory";
import { getDomain, getTextWithCitations } from "@/lib/main-agent/citations";
import { generateErrorResponse } from "@/lib/main-agent/error-recovery";
import {
  getAnthropicClient,
  buildAttachmentBlocks,
  getMainAgentErrorMessage,
  mapMessagesForModel,
  inferServerToolName,
  emitSseEvent,
} from "@/lib/main-agent/helpers";
import { maybeUpdateConversationTitle } from "@/lib/main-agent/titles";
import { prisma } from "@/lib/prisma";
import { calculateCostUsd } from "@/lib/usage";
import { appendRunEvent } from "@/lib/run-events";
import { checkStopFlag, clearStopFlag } from "@/lib/run-stop";
import { invalidateCache } from "@/lib/server-cache";

export async function streamMainAgentRun(input: {
  conversationId: string;
  userId: string;
  prompt: string;
  attachmentIds: string[];
  preferences?: {
    thinking?: boolean;
    effort?: "low" | "medium" | "high";
    memory?: boolean;
  };
}) {
  // Pre-generate runId so we can return it immediately and defer DB writes
  const runId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let titleUpdatePromise: Promise<string> | null = null;
      const pendingWrites: Promise<unknown>[] = [];
      let eventSeq = 0;

      // All events: send SSE to client immediately, persist to DB in background.
      // This eliminates DB round-trip latency from the streaming path.
      const emit = (
        type: TimelineEventEnvelope["type"],
        source: TimelineEventEnvelope["source"],
        payload?: Record<string, unknown> | null,
      ) => {
        const syntheticId = `evt-${runId}-${eventSeq++}`;
        const envelope: TimelineEventEnvelope = {
          id: syntheticId,
          runId,
          conversationId: input.conversationId,
          type,
          source,
          ts: new Date().toISOString(),
          payload: payload ? { ...payload, source } : { source },
        };
        emitSseEvent(controller, envelope);

        // Skip DB persistence for streaming deltas — they're reconstructable from finalMessageJson
        if (type !== "assistant.text.delta" && type !== "assistant.thinking.delta" && type !== "tool.call.input.delta") {
          pendingWrites.push(
            appendRunEvent({
              runId,
              conversationId: input.conversationId,
              type,
              source,
              payload,
            }).catch(() => {}),
          );
        }
      };

      try {
        const anthropic = hasAnthropicApiKey() ? getAnthropicClient() : null;

        // All independent reads in parallel — single DB round-trip
        const [conversationWithSession, attachments, messageHistory, configuredMcpServers] = await Promise.all([
          prisma.conversation.findUniqueOrThrow({
            where: { id: input.conversationId },
            include: {
              repoBinding: {
                select: {
                  id: true,
                  repoFullName: true,
                  defaultBranch: true,
                },
              },
              mainAgentSession: true,
            },
          }),
          input.attachmentIds.length
            ? prisma.attachment.findMany({
                where: {
                  id: { in: input.attachmentIds },
                  conversationId: input.conversationId,
                },
                orderBy: { createdAt: "asc" },
              })
            : Promise.resolve([]),
          prisma.message.findMany({
            where: { conversationId: input.conversationId },
            orderBy: { createdAt: "asc" },
          }),
          getConfiguredMcpServers(input.userId).catch((err) => {
            console.warn("Failed to load MCP servers, continuing without:", err);
            return [] as Awaited<ReturnType<typeof getConfiguredMcpServers>>;
          }),
        ]);

        const conversation = conversationWithSession;

        // Ensure session exists — create only if needed (avoids redundant conversation re-fetch)
        const mainAgentSession = conversationWithSession.mainAgentSession
          ?? await prisma.mainAgentSession.create({
              data: {
                conversationId: input.conversationId,
                userId: input.userId,
              },
            });

        const userContent: BetaContentBlockParam[] = [
          ...buildAttachmentBlocks(
            attachments.map((attachment) => ({
              anthropicFileId: attachment.anthropicFileId,
              kind: attachment.kind,
              filename: attachment.filename,
            })),
          ),
          {
            type: "text",
            text: input.prompt,
          },
        ];

        // Deferred DB writes: overlap with tool construction + API call startup
        const dbWritesPromise = Promise.all([
          prisma.agentRun.create({
            data: {
              id: runId,
              conversationId: input.conversationId,
              userId: input.userId,
              mainAgentSessionId: mainAgentSession.id,
              status: RunStatus.RUNNING,
              userPrompt: input.prompt,
              attachments: input.attachmentIds.length
                ? {
                    connect: input.attachmentIds.map((id) => ({ id })),
                  }
                : undefined,
            },
          }),
          prisma.message.create({
            data: {
              conversationId: input.conversationId,
              role: "USER",
              contentJson: userContent as unknown as Prisma.InputJsonValue,
            },
          }),
        ]);

        titleUpdatePromise = maybeUpdateConversationTitle({
          anthropic,
          conversationId: input.conversationId,
          currentTitle: conversation.title,
          prompt: input.prompt,
          emit,
        });

        if (!anthropic) {
          throw new Error("ANTHROPIC_API_KEY is required to run the main agent.");
        }

        // Build tools and system prompt while DB writes run in parallel
        const tools = getMainAgentTools({
          userId: input.userId,
          conversationId: input.conversationId,
          runId,
          emit: async (type, payload) => emit(type, "main_agent", payload),
        });

        const activeModel = mainAgentSession.anthropicModel ?? env.ANTHROPIC_MAIN_MODEL;
        const prefs = input.preferences ?? {};
        const thinkingEnabled = prefs.thinking !== false;
        const betas: string[] = [
          "compact-2026-01-12",
          "context-management-2025-06-27",
          ...(attachments.length ? ["files-api-2025-04-14"] : []),
          ...(configuredMcpServers.length ? ["mcp-client-2025-11-20"] : []),
        ];

        // Start API call immediately — don't wait for DB writes yet
        const runner = anthropic.beta.messages.toolRunner({
          model: activeModel,
          max_tokens: 16384,
          max_iterations: 20,
          stream: true,
          betas,
          metadata: {
            user_id: input.userId,
          },
          // Thinking: adaptive when enabled, omitted when disabled
          ...(thinkingEnabled ? { thinking: { type: "adaptive" as const } } : {}),
          // Effort: controls response thoroughness
          ...(prefs.effort && prefs.effort !== "high" ? { output_config: { effort: prefs.effort } } : {}),
          system: [
            {
              type: "text" as const,
              text: buildMainAgentSystemPrompt({
                mcpServerNames: configuredMcpServers.map((s) => s.name),
                linkedRepo: conversation.repoBinding
                  ? {
                      repoFullName: conversation.repoBinding.repoFullName,
                      defaultBranch: conversation.repoBinding.defaultBranch,
                      repoBindingId: conversation.repoBinding.id,
                    }
                  : null,
              }),
              cache_control: { type: "ephemeral" as const },
            },
          ],
          context_management: {
            edits: [
              ...(thinkingEnabled ? [{ type: "clear_thinking_20251015" as const }] : []),
              {
                type: "compact_20260112" as const,
                trigger: { type: "input_tokens" as const, value: 140000 },
              },
              { type: "clear_tool_uses_20250919" as const },
            ],
          },
          messages: mapMessagesForModel([
            ...messageHistory.map((message) => ({
              role: message.role,
              contentJson: message.contentJson,
            })),
            // Append current user message — it's not in messageHistory yet
            // because the DB write is deferred and runs in parallel
            {
              role: "USER" as const,
              contentJson: userContent as unknown as Prisma.JsonValue,
            },
          ]),
          tools: [
            // TODO: re-enable server tools after coding session testing
            // ...MAIN_AGENT_SERVER_TOOLS.map((tool) => tool.tool),
            ...tools,
            ...(prefs.memory ? [
              createMemoryTool({ userId: input.userId, conversationId: input.conversationId, runId, emit: async (type, payload) => emit(type, "main_agent", payload) }),
              createMemorySearchTool({ userId: input.userId, conversationId: input.conversationId, runId, emit: async (type, payload) => emit(type, "main_agent", payload) }),
              createMemoryWriteTool({ userId: input.userId, conversationId: input.conversationId, runId, emit: async (type, payload) => emit(type, "main_agent", payload) }),
            ] : []),
            // Generate mcp_toolset entries for each configured MCP server
            ...configuredMcpServers.map((server) => ({
              type: "mcp_toolset" as const,
              mcp_server_name: server.name,
            })),
          ],
          ...(configuredMcpServers.length ? { mcp_servers: configuredMcpServers } : {}),
        } as Parameters<typeof anthropic.beta.messages.toolRunner>[0]);

        // Await DB writes — they've been running in parallel with tool construction + runner creation
        await dbWritesPromise;

        emit("run.started", "system", {
          mainAgentSessionId: mainAgentSession.id,
          attachmentIds: attachments.map((attachment) => attachment.id),
        });

        let stopped = false;
        let serverPartialText = "";
        let stopCheckCounter = 0;

        for await (const assistantIteration of runner) {
          console.log(`[stop-debug] [${runId}] outer loop: new iteration yielded`);
          // Check stop flag between tool runner iterations
          if (await checkStopFlag(runId)) {
            console.log(`[stop-debug] [${runId}] outer loop: stop flag detected at iteration start`);
            stopped = true;
            break;
          }
          const toolInputSnapshots = new Map<number, string>();
          const indexToToolUseId = new Map<number, string>();
          const indexToToolName = new Map<number, string>();

          // Track pending citations per block index for inline streaming citations
          // Each citation includes cited_text so we know when the cited content has been streamed
          const pendingCitations = new Map<number, Array<{ url: string; title: string; cited_text: string }>>();
          const blockTextBuffer = new Map<number, string>();

          for await (const rawEvent of assistantIteration as AsyncIterable<BetaRawMessageStreamEvent>) {
            // Check stop flag every ~10 events to avoid Redis spam
            if (++stopCheckCounter % 10 === 0) {
              const flagValue = await checkStopFlag(runId);
              console.log(`[stop-debug] [${runId}] inner loop: check #${stopCheckCounter}, flag=${flagValue}`);
              if (flagValue) {
                console.log(`[stop-debug] [${runId}] inner loop: breaking inner loop`);
                stopped = true;
                break;
              }
            }
            if (rawEvent.type === "content_block_start") {
              const block = rawEvent.content_block;

              if (block.type === "text" && block.text) {
                emit("assistant.text.delta", "main_agent", {
                  delta: block.text,
                  index: rawEvent.index,
                });
              }

              if (block.type === "thinking" && block.thinking) {
                emit("assistant.thinking.delta", "main_agent", {
                  delta: block.thinking,
                  index: rawEvent.index,
                });
              }

              if (block.type === "server_tool_use") {
                indexToToolUseId.set(rawEvent.index, block.id);
                indexToToolName.set(rawEvent.index, block.name);
                emit("tool.call.started", "main_agent", {
                  toolName: block.name,
                  toolRuntime: "anthropic_server",
                  toolUseId: block.id,
                  input: block.input,
                  index: rawEvent.index,
                });
              }

              // Client tool use (custom backend tools like chat_search, github, coding)
              if (block.type === "tool_use") {
                indexToToolUseId.set(rawEvent.index, block.id);
                indexToToolName.set(rawEvent.index, block.name);
                emit("tool.call.started", "main_agent", {
                  toolName: block.name,
                  toolRuntime: "custom_backend",
                  toolUseId: block.id,
                  input: block.input,
                  index: rawEvent.index,
                });
              }

              // MCP tool use (external MCP server tools)
              if ((block as unknown as { type: string }).type === "mcp_tool_use") {
                const mcpBlock = block as unknown as { id: string; name: string; input: unknown; server_name: string };
                indexToToolUseId.set(rawEvent.index, mcpBlock.id);
                indexToToolName.set(rawEvent.index, mcpBlock.name);
                emit("tool.call.started", "main_agent", {
                  toolName: mcpBlock.name,
                  toolRuntime: `mcp:${mcpBlock.server_name}`,
                  toolUseId: mcpBlock.id,
                  input: mcpBlock.input,
                  index: rawEvent.index,
                });
              }

              // MCP tool result
              if ((block as unknown as { type: string }).type === "mcp_tool_result") {
                const mcpResult = block as unknown as { tool_use_id: string; content: unknown };
                const toolUseId = mcpResult.tool_use_id;
                // Find the matching tool name from our tracking
                const matchingName = Array.from(indexToToolUseId.entries())
                  .find(([, id]) => id === toolUseId);
                const toolName = matchingName ? indexToToolName.get(matchingName[0]) ?? "mcp_tool" : "mcp_tool";

                emit("tool.call.completed", "main_agent", {
                  toolName,
                  toolRuntime: "mcp",
                  toolUseId,
                  result: mcpResult.content,
                });
              }

              // MCP tool use (tools from external MCP servers)
              if ("type" in block) {
                const blockType = (block as unknown as { type: string }).type;
                if (blockType === "mcp_tool_use") {
                  const mcpBlock = block as unknown as { id: string; name: string; input: unknown; server_name: string };
                  indexToToolUseId.set(rawEvent.index, mcpBlock.id);
                  indexToToolName.set(rawEvent.index, mcpBlock.name);
                  emit("tool.call.started", "main_agent", {
                    toolName: mcpBlock.name,
                    toolRuntime: `mcp:${mcpBlock.server_name}`,
                    toolUseId: mcpBlock.id,
                    input: mcpBlock.input,
                    index: rawEvent.index,
                  });
                }

                // MCP tool result
                if (blockType === "mcp_tool_result") {
                  const mcpResult = block as unknown as { tool_use_id: string; content: unknown; is_error?: boolean };
                  emit("tool.call.completed", "main_agent", {
                    toolName: indexToToolName.get(rawEvent.index) ?? "mcp_tool",
                    toolRuntime: "mcp",
                    toolUseId: mcpResult.tool_use_id,
                    result: mcpResult.content,
                    isError: mcpResult.is_error ?? false,
                  });
                }
              }

              // Handle compaction blocks (context was summarized)
              if ("type" in block && (block as unknown as { type: string }).type === "compaction") {
                emit("tool.call.completed", "system", {
                  toolName: "compaction",
                  toolRuntime: "anthropic_server",
                  result: "Context was automatically compacted to manage conversation length.",
                });
              }

              if (
                block.type === "web_search_tool_result" ||
                block.type === "web_fetch_tool_result" ||
                block.type === "code_execution_tool_result" ||
                block.type === "tool_search_tool_result"
              ) {
                emit("tool.call.completed", "main_agent", {
                  toolName: inferServerToolName(block),
                  toolRuntime: "anthropic_server",
                  toolUseId: block.tool_use_id,
                  result: block.content,
                });
              }

              // Handle newer code execution tool result types
              if ("type" in block) {
                const blockType = (block as unknown as { type: string }).type;
                if (
                  blockType === "bash_code_execution_tool_result" ||
                  blockType === "text_editor_code_execution_tool_result"
                ) {
                  const anyBlock = block as unknown as { type: string; tool_use_id: string; content: unknown };
                  emit("tool.call.completed", "main_agent", {
                    toolName: blockType === "bash_code_execution_tool_result" ? "code_execution" : "text_editor",
                    toolRuntime: "anthropic_server",
                    toolUseId: anyBlock.tool_use_id,
                    result: anyBlock.content,
                  });
                }
              }
            }

            // Clean up citation state when a block ends
            if (rawEvent.type === "content_block_stop") {
              // If there are leftover pending citations when block ends, flush them
              const leftover = pendingCitations.get(rawEvent.index);
              if (leftover?.length) {
                const citationSuffix = leftover.map((c) => {
                  const domain = getDomain(c.url);
                  const safeTitle = c.title.replace(/"/g, "'");
                  return ` [${domain}](${c.url} "${safeTitle}")`;
                }).join("");
                emit("assistant.text.delta", "main_agent", {
                  delta: citationSuffix,
                  index: rawEvent.index,
                });
                pendingCitations.delete(rawEvent.index);
              }
              blockTextBuffer.delete(rawEvent.index);
            }

            if (rawEvent.type === "content_block_delta") {
              // Capture citation deltas with cited_text
              const delta = rawEvent.delta as unknown as Record<string, unknown>;
              if (delta.type === "citations_delta" && delta.citation) {
                const citation = delta.citation as { url?: string; title?: string; cited_text?: string };
                if (citation.url && citation.title && citation.cited_text) {
                  const existing = pendingCitations.get(rawEvent.index) ?? [];
                  if (!existing.some((c) => c.url === citation.url)) {
                    existing.push({
                      url: citation.url,
                      title: citation.title,
                      cited_text: citation.cited_text.replace(/\.{3}$/, "").trim(),
                    });
                    pendingCitations.set(rawEvent.index, existing);
                  }
                }
              }

              if (rawEvent.delta.type === "text_delta") {
                serverPartialText += rawEvent.delta.text;
                const citations = pendingCitations.get(rawEvent.index);
                let textToEmit = rawEvent.delta.text;

                if (citations?.length) {
                  // Accumulate buffer to match against cited_text
                  const buffer = (blockTextBuffer.get(rawEvent.index) ?? "") + rawEvent.delta.text;
                  blockTextBuffer.set(rawEvent.index, buffer);

                  // Check each pending citation: has the buffer accumulated enough
                  // of the cited_text AND does the current delta end a sentence?
                  const toPlace: typeof citations = [];
                  const remaining: typeof citations = [];

                  for (const c of citations) {
                    // Use a prefix of cited_text (first 30 chars) to check if
                    // we've streamed past the cited content
                    const probe = c.cited_text.slice(0, 30);
                    const bufferHasCitedContent = buffer.includes(probe);

                    if (bufferHasCitedContent) {
                      toPlace.push(c);
                    } else {
                      remaining.push(c);
                    }
                  }

                  if (toPlace.length > 0) {
                    // Look for sentence end in current delta
                    const sentenceEndMatch = rawEvent.delta.text.match(/[.!?](?:\s|$)/);
                    if (sentenceEndMatch) {
                      const insertPos = sentenceEndMatch.index! + 1;
                      const citationSuffix = toPlace.map((c) => {
                        const domain = getDomain(c.url);
                        const safeTitle = c.title.replace(/"/g, "'");
                        return ` [${domain}](${c.url} "${safeTitle}")`;
                      }).join("");

                      textToEmit =
                        rawEvent.delta.text.slice(0, insertPos) +
                        citationSuffix +
                        rawEvent.delta.text.slice(insertPos);

                      // Update pending — keep only unplaced citations
                      if (remaining.length > 0) {
                        pendingCitations.set(rawEvent.index, remaining);
                      } else {
                        pendingCitations.delete(rawEvent.index);
                      }
                      blockTextBuffer.delete(rawEvent.index);
                    }
                  }
                }

                emit("assistant.text.delta", "main_agent", {
                  delta: textToEmit,
                  index: rawEvent.index,
                });
              }

              if (rawEvent.delta.type === "thinking_delta") {
                emit("assistant.thinking.delta", "main_agent", {
                  delta: rawEvent.delta.thinking,
                  index: rawEvent.index,
                });
              }

              if (rawEvent.delta.type === "input_json_delta") {
                const nextSnapshot = `${toolInputSnapshots.get(rawEvent.index) ?? ""}${rawEvent.delta.partial_json}`;
                toolInputSnapshots.set(rawEvent.index, nextSnapshot);
                emit("tool.call.input.delta", "main_agent", {
                  delta: rawEvent.delta.partial_json,
                  snapshot: nextSnapshot,
                  index: rawEvent.index,
                  toolUseId: indexToToolUseId.get(rawEvent.index),
                  toolName: indexToToolName.get(rawEvent.index),
                });
              }
            }
          }
          // Break outer loop immediately so the runner doesn't start
          // another API call before we can act on the stop flag
          if (stopped) {
            console.log(`[stop-debug] [${runId}] breaking outer loop after inner loop exit`);
            break;
          }
          console.log(`[stop-debug] [${runId}] inner loop ended naturally, continuing outer loop`);
        }

        console.log(`[stop-debug] [${runId}] exited loop. stopped=${stopped}`);

        // If stopped by client via Redis flag, save partial state and close gracefully
        if (stopped) {
          console.log(`[stop-debug] [${runId}] saving partial state and closing stream`);
          await clearStopFlag(runId);

          const partialText = serverPartialText.trim() || null;

          // Save partial assistant message so it persists across refresh
          await Promise.all([
            partialText
              ? prisma.message.create({
                  data: {
                    conversationId: input.conversationId,
                    role: "ASSISTANT",
                    contentJson: [{ type: "text", text: partialText }] as unknown as Prisma.InputJsonValue,
                  },
                })
              : Promise.resolve(),
            prisma.agentRun.update({
              where: { id: runId },
              data: {
                status: RunStatus.CANCELLED,
                finalText: partialText,
                metadataJson: { cancelled: true } as Prisma.InputJsonValue,
                cancelledAt: new Date(),
                completedAt: new Date(),
              },
            }),
          ]).catch(() => {});

          emit("run.cancelled", "system", { status: "cancelled" });
          try { controller.close(); } catch { /* client already disconnected */ }
          await Promise.allSettled(pendingWrites);
          return;
        }

        const finalMessage: BetaMessage = await runner.done();

        // Emit MCP tool events from the final response (toolRunner handles MCP
        // between iterations, so they don't appear in the streaming loop)
        const mcpToolNames = new Map<string, string>();
        for (const block of finalMessage.content) {
          const blockAny = block as unknown as Record<string, unknown>;
          if (blockAny.type === "mcp_tool_use") {
            const name = String(blockAny.name ?? "mcp_tool");
            const serverName = String(blockAny.server_name ?? "mcp");
            mcpToolNames.set(String(blockAny.id), name);
            emit("tool.call.started", "main_agent", {
              toolName: name,
              toolRuntime: `mcp:${serverName}`,
              toolUseId: blockAny.id,
              input: blockAny.input,
            });
          }
          if (blockAny.type === "mcp_tool_result") {
            const toolUseId = String(blockAny.tool_use_id ?? "");
            const content = blockAny.content;
            // Extract text from content array if present
            let resultText = "";
            if (Array.isArray(content)) {
              resultText = (content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === "text" && c.text)
                .map((c) => c.text)
                .join("\n")
                .slice(0, 2000);
            }
            emit(
              blockAny.is_error ? "tool.call.failed" : "tool.call.completed",
              "main_agent",
              {
                toolName: mcpToolNames.get(toolUseId) ?? "mcp_tool",
                toolRuntime: "mcp",
                toolUseId,
                result: resultText || content,
              },
            );
          }
        }

        const finalText = getTextWithCitations(finalMessage.content);

        const usageRaw = finalMessage.usage as unknown as Record<string, unknown>;
        const inputTokens = finalMessage.usage.input_tokens;
        const outputTokens = finalMessage.usage.output_tokens;
        const cacheReadTokens = Number(usageRaw.cache_read_input_tokens ?? 0);
        const cacheWriteTokens = Number(usageRaw.cache_creation_input_tokens ?? 0);
        const costUsd = calculateCostUsd({
          model: finalMessage.model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        });

        // Wait for title update so the event reaches the client before stream close
        await titleUpdatePromise;

        // Send final SSE events to client immediately (no DB round-trip)
        emit("assistant.message.completed", "main_agent", {
          text: finalText,
          model: finalMessage.model,
          stopReason: finalMessage.stop_reason,
          usage: {
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: cacheWriteTokens,
            cacheReadInputTokens: cacheReadTokens,
          },
        });

        emit("run.completed", "system", {
          status: "completed",
        });

        // Close stream — client has all data it needs
        try { controller.close(); } catch { /* client may have disconnected */ }

        // DB finalization runs after stream close (still within start(), process stays alive)
        await Promise.all([
          prisma.message.create({
            data: {
              conversationId: input.conversationId,
              role: "ASSISTANT",
              contentJson: finalMessage.content as unknown as Prisma.InputJsonValue,
            },
          }),
          prisma.agentRun.update({
            where: { id: runId },
            data: {
              status: RunStatus.COMPLETED,
              finalText,
              finalMessageJson: finalMessage as unknown as Prisma.InputJsonValue,
              model: finalMessage.model,
              inputTokens,
              outputTokens,
              cacheReadTokens,
              cacheWriteTokens,
              costUsd,
              metadataJson: {
                model: finalMessage.model,
                stopReason: finalMessage.stop_reason,
                usage: {
                  inputTokens,
                  outputTokens,
                  cacheCreationInputTokens: cacheWriteTokens,
                  cacheReadInputTokens: cacheReadTokens,
                  serverToolUse: usageRaw.server_tool_use ?? null,
                },
              } as Prisma.InputJsonValue,
              completedAt: new Date(),
            },
          }),
          prisma.mainAgentSession.update({
            where: { id: mainAgentSession.id },
            data: { anthropicModel: finalMessage.model },
          }),
        ]);

        void invalidateCache(
          `conv:${input.conversationId}`,
          `convos:${input.userId}`,
        );
      } catch (error) {
        const message = getMainAgentErrorMessage(error);

        if (titleUpdatePromise) {
          await titleUpdatePromise.catch(() => {});
        }

        emit("run.failed", "system", { error: message });

        // Generate a user-friendly error response so the user sees
        // a final assistant message instead of a blank chat.
        // Uses OpenAI gpt-4o-mini first (different provider, unaffected by Anthropic issues),
        // falls back to Anthropic Haiku, then a static message.
        const errorFinalText = await generateErrorResponse(
          hasAnthropicApiKey() ? getAnthropicClient() : null,
          input.prompt,
          message,
        );

        emit("assistant.message.completed", "main_agent", {
          text: errorFinalText,
          stopReason: "error_recovery",
        });

        // Persist the error recovery message so it shows on reload
        pendingWrites.push(
          prisma.message.create({
            data: {
              conversationId: input.conversationId,
              role: "ASSISTANT",
              contentJson: [{ type: "text", text: errorFinalText }] as unknown as Prisma.InputJsonValue,
            },
          }).catch(() => {}),
        );

        try { controller.close(); } catch { /* client may have disconnected */ }

        // AgentRun may not exist if error occurred before DB writes completed
        await prisma.agentRun.update({
          where: { id: runId },
          data: {
            status: RunStatus.FAILED,
            finalText: errorFinalText,
            metadataJson: {
              error: message,
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        }).catch(() => {});
      } finally {
        // Flush remaining background DB writes (event persistence)
        await Promise.allSettled(pendingWrites);
      }
    },
  });

  return {
    runId,
    stream,
  };
}
