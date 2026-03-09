import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaRequestDocumentBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Prisma, RunStatus } from "@prisma/client";

import { ensureMainAgentSession } from "@/lib/conversations";
import { type AttachmentDto, type TimelineEventEnvelope } from "@/lib/contracts";
import { env, hasAnthropicApiKey } from "@/lib/env";
import { getConfiguredMcpServers } from "@/lib/main-agent/mcp";
import { MAIN_AGENT_SYSTEM_PROMPT } from "@/lib/main-agent/system-prompt";
import { MAIN_AGENT_SERVER_TOOLS } from "@/lib/main-agent/tool-catalog";
import { createMainAgentTools } from "@/lib/main-agent/tools";
import { prisma } from "@/lib/prisma";
import { appendRunEvent, serializeSseEvent } from "@/lib/run-events";
import { invalidateCache } from "@/lib/server-cache";

const encoder = new TextEncoder();
const untitledConversationNames = new Set(["New chat", "Untitled"]);

function getAnthropicClient() {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
  });
}

function buildAttachmentBlocks(attachments: Array<{ anthropicFileId: string | null; kind: AttachmentDto["kind"]; filename: string }>) {
  const blocks: Array<BetaImageBlockParam | BetaRequestDocumentBlock> = [];

  for (const attachment of attachments) {
    if (!attachment.anthropicFileId) {
      continue;
    }

    if (attachment.kind === "IMAGE") {
      blocks.push({
        type: "image",
        source: {
          type: "file",
          file_id: attachment.anthropicFileId,
        },
      });
      continue;
    }

    blocks.push({
      type: "document",
      source: {
        type: "file",
        file_id: attachment.anthropicFileId,
      },
      title: attachment.filename,
      citations: {
        enabled: true,
      },
    });
  }

  return blocks;
}

function buildFallbackConversationTitle(prompt: string) {
  const compact = prompt
    .replace(/\s+/g, " ")
    .replace(/[“”"'`]+/g, "")
    .trim();

  if (!compact) {
    return "New chat";
  }

  return compact.length > 56 ? `${compact.slice(0, 55).trimEnd()}…` : compact;
}

function normalizeConversationTitle(title: string, fallbackTitle: string) {
  const normalized = title
    .replace(/[#*_~`>\[\](){}|\\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.:;!?,]+$/g, "")
    .trim();

  if (!normalized) {
    return fallbackTitle;
  }

  // Cap at ~4 words
  const words = normalized.split(" ");
  const capped = words.length > 4 ? words.slice(0, 4).join(" ") : normalized;

  return capped.length > 40 ? `${capped.slice(0, 39).trimEnd()}…` : capped;
}

function getTextFromContentBlocks(content: BetaContentBlock[]) {
  return content
    .filter((block): block is Extract<BetaContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function getAssistantHistoryContent(content: unknown): BetaContentBlockParam[] | string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content.filter((block): block is BetaContentBlockParam => {
    return typeof block === "object" && block != null && "type" in block && block.type === "text";
  });
}

function normalizeAnthropicErrorMessage(message: string) {
  const jsonStart = message.indexOf("{");

  if (jsonStart === -1) {
    return message;
  }

  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as {
      error?: { message?: string | null } | null;
      message?: string | null;
    };

    return parsed.error?.message ?? parsed.message ?? message;
  } catch {
    return message;
  }
}

function getMainAgentErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return normalizeAnthropicErrorMessage(error.message);
  }

  if (typeof error === "string") {
    return normalizeAnthropicErrorMessage(error);
  }

  return "Unknown main agent error";
}

function mapMessagesForModel(messages: Array<{ role: string; contentJson: unknown }>): BetaMessageParam[] {
  return messages.flatMap((message) => {
    if (message.role === "SYSTEM") {
      return [];
    }

    const content =
      message.role === "ASSISTANT"
        ? getAssistantHistoryContent(message.contentJson)
        : (message.contentJson as BetaContentBlockParam[] | string);

    if (content === "" || (Array.isArray(content) && content.length === 0)) {
      return [];
    }

    return [
      {
        role: message.role.toLowerCase() as "user" | "assistant",
        content,
      },
    ];
  });
}

function inferServerToolName(block: BetaContentBlock) {
  switch (block.type) {
    case "web_search_tool_result":
      return "web_search";
    case "web_fetch_tool_result":
      return "web_fetch";
    case "code_execution_tool_result":
      return "code_execution";
    case "tool_search_tool_result":
      return "tool_search";
    default:
      return block.type;
  }
}

async function emitSseEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: TimelineEventEnvelope,
) {
  controller.enqueue(encoder.encode(serializeSseEvent(event)));
}

async function maybeGenerateConversationTitle(input: {
  anthropic: Anthropic | null;
  prompt: string;
}) {
  const fallbackTitle = buildFallbackConversationTitle(input.prompt);

  if (!input.anthropic || !hasAnthropicApiKey()) {
    return fallbackTitle;
  }

  try {
    const response = await input.anthropic.messages.create({
      model: env.ANTHROPIC_TITLE_MODEL,
      max_tokens: 12,
      temperature: 0,
      system:
        "Generate a 2-4 word chat title from the user's first message. Plain text only — no markdown, no quotation marks, no punctuation, no commentary. Just the title words.",
      messages: [
        {
          role: "user",
          content: input.prompt,
        },
      ],
    });

    const suggestedTitle = response.content
      .filter((block): block is Extract<(typeof response.content)[number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join(" ");

    return normalizeConversationTitle(suggestedTitle, fallbackTitle);
  } catch {
    return fallbackTitle;
  }
}

async function maybeUpdateConversationTitle(input: {
  anthropic: Anthropic | null;
  conversationId: string;
  currentTitle: string;
  prompt: string;
  emit: (
    type: TimelineEventEnvelope["type"],
    source: TimelineEventEnvelope["source"],
    payload?: Record<string, unknown> | null,
  ) => Promise<void>;
}) {
  if (!untitledConversationNames.has(input.currentTitle) || !input.prompt.trim()) {
    return input.currentTitle;
  }

  const nextTitle = await maybeGenerateConversationTitle({
    anthropic: input.anthropic,
    prompt: input.prompt,
  });

  if (!nextTitle || nextTitle === input.currentTitle) {
    return input.currentTitle;
  }

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      title: nextTitle,
    },
  });

  await input.emit("conversation.updated", "system", {
    title: nextTitle,
  });

  void invalidateCache(`conv:${input.conversationId}`);

  return nextTitle;
}

export async function streamMainAgentRun(input: {
  conversationId: string;
  userId: string;
  prompt: string;
  attachmentIds: string[];
}) {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: input.conversationId },
    select: {
      id: true,
      title: true,
    },
  });
  const mainAgentSession = await ensureMainAgentSession({
    conversationId: input.conversationId,
    userId: input.userId,
  });

  const attachments = input.attachmentIds.length
    ? await prisma.attachment.findMany({
        where: {
          id: {
            in: input.attachmentIds,
          },
          conversationId: input.conversationId,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

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

  const createdRun = await prisma.agentRun.create({
    data: {
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
  });

  await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      role: "USER",
      contentJson: userContent as unknown as Prisma.InputJsonValue,
    },
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let titleUpdatePromise: Promise<string> | null = null;
      const pendingWrites: Promise<unknown>[] = [];
      let eventSeq = 0;

      // Stream-first emit: send SSE to client immediately, persist to DB in background.
      // Only structural events (run.started, run.completed, run.failed, assistant.message.completed)
      // are awaited to guarantee ordering for post-run queries.
      const streamingDeltaTypes = new Set([
        "assistant.text.delta",
        "assistant.thinking.delta",
        "tool.call.input.delta",
      ]);

      const emit = async (
        type: TimelineEventEnvelope["type"],
        source: TimelineEventEnvelope["source"],
        payload?: Record<string, unknown> | null,
      ) => {
        const isFireAndForget = streamingDeltaTypes.has(type);

        if (isFireAndForget) {
          // Send SSE immediately with a synthetic envelope (no DB round-trip)
          const syntheticId = `evt-${createdRun.id}-${eventSeq++}`;
          const envelope: TimelineEventEnvelope = {
            id: syntheticId,
            runId: createdRun.id,
            conversationId: input.conversationId,
            type,
            source,
            ts: new Date().toISOString(),
            payload: payload ? { ...payload, source } : { source },
          };
          await emitSseEvent(controller, envelope);

          // Persist in background — don't block the stream
          pendingWrites.push(
            appendRunEvent({
              runId: createdRun.id,
              conversationId: input.conversationId,
              type,
              source,
              payload,
            }).catch(() => {}),
          );
        } else {
          // Structural events: persist first, then emit
          const event = await appendRunEvent({
            runId: createdRun.id,
            conversationId: input.conversationId,
            type,
            source,
            payload,
          });
          await emitSseEvent(controller, event);
        }
      };

      try {
        const anthropic = hasAnthropicApiKey() ? getAnthropicClient() : null;
        titleUpdatePromise = maybeUpdateConversationTitle({
          anthropic,
          conversationId: input.conversationId,
          currentTitle: conversation.title,
          prompt: input.prompt,
          emit,
        });

        await emit("run.started", "system", {
          mainAgentSessionId: mainAgentSession.id,
          attachmentIds: attachments.map((attachment) => attachment.id),
        });

        if (!anthropic) {
          throw new Error("ANTHROPIC_API_KEY is required to run the main agent.");
        }

        const messageHistory = await prisma.message.findMany({
          where: {
            conversationId: input.conversationId,
          },
          orderBy: { createdAt: "asc" },
        });

        const tools = createMainAgentTools({
          userId: input.userId,
          conversationId: input.conversationId,
          runId: createdRun.id,
          emit: async (type, payload) => emit(type, "main_agent", payload),
        });
        const configuredMcpServers = getConfiguredMcpServers();
        const activeModel = mainAgentSession.anthropicModel ?? env.ANTHROPIC_MAIN_MODEL;
        const betas: string[] = [
          "compact-2026-01-12",
          "context-management-2025-06-27",
          ...(attachments.length ? ["files-api-2025-04-14"] : []),
          ...(configuredMcpServers.length ? ["mcp-client-2025-11-20"] : []),
        ];

        const runner = anthropic.beta.messages.toolRunner({
          model: activeModel,
          max_tokens: 4096,
          max_iterations: 8,
          stream: true,
          betas,
          metadata: {
            user_id: input.userId,
          },
          thinking: {
            type: "enabled",
            budget_tokens: 1024,
          },
          system: [
            {
              type: "text" as const,
              text: MAIN_AGENT_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" as const },
            },
          ],
          context_management: {
            edits: [
              { type: "clear_thinking_20251015" as const },
              {
                type: "compact_20260112" as const,
                trigger: { type: "input_tokens" as const, value: 140000 },
              },
              { type: "clear_tool_uses_20250919" as const },
            ],
          },
          messages: mapMessagesForModel(
            messageHistory.map((message) => ({
              role: message.role,
              contentJson: message.contentJson,
            })),
          ),
          tools: [...MAIN_AGENT_SERVER_TOOLS.map((tool) => tool.tool), ...tools],
          ...(configuredMcpServers.length ? { mcp_servers: configuredMcpServers } : {}),
        } as Parameters<typeof anthropic.beta.messages.toolRunner>[0]);

        for await (const assistantIteration of runner) {
          const toolInputSnapshots = new Map<number, string>();
          const indexToToolUseId = new Map<number, string>();
          const indexToToolName = new Map<number, string>();

          for await (const rawEvent of assistantIteration as AsyncIterable<BetaRawMessageStreamEvent>) {
            if (rawEvent.type === "content_block_start") {
              const block = rawEvent.content_block;

              if (block.type === "text" && block.text) {
                await emit("assistant.text.delta", "main_agent", {
                  delta: block.text,
                  index: rawEvent.index,
                });
              }

              if (block.type === "thinking" && block.thinking) {
                await emit("assistant.thinking.delta", "main_agent", {
                  delta: block.thinking,
                  index: rawEvent.index,
                });
              }

              if (block.type === "server_tool_use") {
                indexToToolUseId.set(rawEvent.index, block.id);
                indexToToolName.set(rawEvent.index, block.name);
                await emit("tool.call.started", "main_agent", {
                  toolName: block.name,
                  toolRuntime: "anthropic_server",
                  toolUseId: block.id,
                  input: block.input,
                  index: rawEvent.index,
                });
              }

              // Handle compaction blocks (context was summarized)
              if ("type" in block && (block as unknown as { type: string }).type === "compaction") {
                await emit("tool.call.completed", "system", {
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
                await emit("tool.call.completed", "main_agent", {
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
                  await emit("tool.call.completed", "main_agent", {
                    toolName: blockType === "bash_code_execution_tool_result" ? "code_execution" : "text_editor",
                    toolRuntime: "anthropic_server",
                    toolUseId: anyBlock.tool_use_id,
                    result: anyBlock.content,
                  });
                }
              }
            }

            if (rawEvent.type === "content_block_delta") {
              if (rawEvent.delta.type === "text_delta") {
                await emit("assistant.text.delta", "main_agent", {
                  delta: rawEvent.delta.text,
                  index: rawEvent.index,
                });
              }

              if (rawEvent.delta.type === "thinking_delta") {
                await emit("assistant.thinking.delta", "main_agent", {
                  delta: rawEvent.delta.thinking,
                  index: rawEvent.index,
                });
              }

              if (rawEvent.delta.type === "input_json_delta") {
                const nextSnapshot = `${toolInputSnapshots.get(rawEvent.index) ?? ""}${rawEvent.delta.partial_json}`;
                toolInputSnapshots.set(rawEvent.index, nextSnapshot);
                await emit("tool.call.input.delta", "main_agent", {
                  delta: rawEvent.delta.partial_json,
                  snapshot: nextSnapshot,
                  index: rawEvent.index,
                  toolUseId: indexToToolUseId.get(rawEvent.index),
                  toolName: indexToToolName.get(rawEvent.index),
                });
              }
            }
          }
        }

        const finalMessage: BetaMessage = await runner.done();
        const finalText = getTextFromContentBlocks(finalMessage.content);

        await prisma.message.create({
          data: {
            conversationId: input.conversationId,
            role: "ASSISTANT",
            contentJson: finalMessage.content as unknown as Prisma.InputJsonValue,
          },
        });

        await prisma.agentRun.update({
          where: { id: createdRun.id },
          data: {
            status: RunStatus.COMPLETED,
            finalText,
            finalMessageJson: finalMessage as unknown as Prisma.InputJsonValue,
            metadataJson: {
              model: finalMessage.model,
              stopReason: finalMessage.stop_reason,
              usage: {
                inputTokens: finalMessage.usage.input_tokens,
                outputTokens: finalMessage.usage.output_tokens,
                cacheCreationInputTokens: (finalMessage.usage as unknown as Record<string, unknown>).cache_creation_input_tokens ?? null,
                cacheReadInputTokens: (finalMessage.usage as unknown as Record<string, unknown>).cache_read_input_tokens ?? null,
                serverToolUse: (finalMessage.usage as unknown as Record<string, unknown>).server_tool_use ?? null,
              },
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });

        await prisma.mainAgentSession.update({
          where: { id: mainAgentSession.id },
          data: {
            anthropicModel: finalMessage.model,
          },
        });

        await titleUpdatePromise;

        await emit("assistant.message.completed", "main_agent", {
          text: finalText,
          model: finalMessage.model,
          stopReason: finalMessage.stop_reason,
          usage: {
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
            cacheCreationInputTokens: (finalMessage.usage as unknown as Record<string, unknown>).cache_creation_input_tokens ?? null,
            cacheReadInputTokens: (finalMessage.usage as unknown as Record<string, unknown>).cache_read_input_tokens ?? null,
          },
        });

        await emit("run.completed", "system", {
          status: "completed",
        });

        void invalidateCache(
          `conv:${input.conversationId}`,
          `convos:${input.userId}`,
        );
      } catch (error) {
        const message = getMainAgentErrorMessage(error);

        if (titleUpdatePromise) {
          await titleUpdatePromise;
        }

        await prisma.agentRun.update({
          where: { id: createdRun.id },
          data: {
            status: RunStatus.FAILED,
            metadataJson: {
              error: message,
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });

        const event = await appendRunEvent({
          runId: createdRun.id,
          conversationId: input.conversationId,
          type: "run.failed",
          source: "system",
          payload: {
            error: message,
          },
        });

        await emitSseEvent(controller, event);
      } finally {
        // Flush any remaining background DB writes before closing
        await Promise.allSettled(pendingWrites);
        controller.close();
      }
    },
  });

  return {
    runId: createdRun.id,
    stream,
  };
}
