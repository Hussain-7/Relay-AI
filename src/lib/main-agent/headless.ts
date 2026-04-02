import type { BetaContentBlockParam, BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import * as Sentry from "@sentry/nextjs";
import { type Prisma, RunStatus } from "@/generated/prisma/client";

import { env, hasAnthropicApiKey } from "@/lib/env";
import { getTextWithCitations } from "@/lib/main-agent/citations";
import { getAnthropicClient, getMainAgentErrorMessage, mapMessagesForModel } from "@/lib/main-agent/helpers";
import { getConfiguredMcpServers } from "@/lib/main-agent/mcp";
import { buildMainAgentSystemPrompt } from "@/lib/main-agent/system-prompt";
import { getMainAgentTools, MAIN_AGENT_SERVER_TOOLS } from "@/lib/main-agent/tools";
import { createMemoryTool } from "@/lib/main-agent/tools/memory";
import { prisma } from "@/lib/prisma";
import { calculateCostUsd } from "@/lib/usage";

export interface HeadlessRunInput {
  conversationId: string;
  userId: string;
  prompt: string;
  preferences?: {
    model?: string;
    thinking?: boolean;
    effort?: "low" | "medium" | "high";
    memory?: boolean;
  };
  mcpConnectorIds?: string[];
  /** When true, skip loading prior message history — each run starts with a clean context but messages still persist in the conversation for traceability. */
  skipHistory?: boolean;
}

export interface HeadlessRunResult {
  runId: string;
  finalText: string;
  success: boolean;
  error?: string;
}

/**
 * Execute a main agent run without SSE streaming.
 * Used by scheduled prompts and other background job contexts.
 * Reuses the same Anthropic toolRunner setup as runtime.ts but runs to completion synchronously.
 */
export async function executeMainAgentHeadless(input: HeadlessRunInput): Promise<HeadlessRunResult> {
  const runId = crypto.randomUUID();
  console.log("[headless] starting run", runId, {
    conversationId: input.conversationId,
    userId: input.userId,
    prompt: input.prompt.slice(0, 80),
    model: input.preferences?.model,
  });

  try {
    const anthropic = hasAnthropicApiKey() ? getAnthropicClient() : null;
    if (!anthropic) {
      throw new Error("ANTHROPIC_API_KEY is required to run the main agent.");
    }

    // Load conversation, history, MCP servers, and active coding session in parallel
    const [conversationWithSession, messageHistory, configuredMcpServers, activeCodingSession] = await Promise.all([
      prisma.conversation.findUniqueOrThrow({
        where: { id: input.conversationId },
        include: {
          repoBinding: {
            select: { id: true, repoFullName: true, defaultBranch: true },
          },
          mainAgentSession: true,
        },
      }),
      input.skipHistory
        ? Promise.resolve([])
        : prisma.message
            .findMany({
              where: { conversationId: input.conversationId },
              orderBy: { createdAt: "desc" },
              take: 200,
            })
            .then((msgs) => msgs.reverse()),
      getConfiguredMcpServers(input.userId, input.mcpConnectorIds).catch((err) => {
        console.warn("[headless] Failed to load MCP servers:", err);
        return [] as Awaited<ReturnType<typeof getConfiguredMcpServers>>;
      }),
      prisma.codingSession.findFirst({
        where: {
          conversationId: input.conversationId,
          status: { in: ["PROVISIONING", "READY", "RUNNING", "PAUSED", "ERROR"] },
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, status: true, sandboxId: true, workspacePath: true, branch: true },
      }),
    ]);

    const conversation = conversationWithSession;

    // Ensure MainAgentSession exists
    const mainAgentSession =
      conversationWithSession.mainAgentSession ??
      (await prisma.mainAgentSession.create({
        data: { conversationId: input.conversationId, userId: input.userId },
      }));

    console.log("[headless] loaded context", {
      messageHistory: messageHistory.length,
      mcpServers: configuredMcpServers.length,
      hasCodingSession: !!activeCodingSession,
      hasRepo: !!conversation.repoBinding,
    });

    const prefs = input.preferences ?? {};
    const activeModel = prefs.model ?? mainAgentSession.anthropicModel ?? env.ANTHROPIC_MAIN_MODEL;
    const thinkingEnabled = prefs.thinking !== false;

    // Build user content
    const userContent: BetaContentBlockParam[] = [{ type: "text", text: input.prompt }];

    // Create AgentRun + user Message
    await Promise.all([
      prisma.agentRun.create({
        data: {
          id: runId,
          conversationId: input.conversationId,
          userId: input.userId,
          mainAgentSessionId: mainAgentSession.id,
          status: RunStatus.RUNNING,
          userPrompt: input.prompt,
          model: activeModel,
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

    // Build tools — use a no-op emitter for headless mode
    const toolCtx = {
      userId: input.userId,
      conversationId: input.conversationId,
      runId,
      emit: async (_type: string, _payload: Record<string, unknown>) => {},
      emitProgress: () => {},
    };
    const tools = getMainAgentTools(toolCtx, activeCodingSession);

    // Filter out ask_user tool — not usable in headless/background mode
    const filteredTools = tools.filter((t) => {
      const toolAny = t as unknown as Record<string, unknown>;
      return toolAny.name !== "ask_user";
    });

    const betas: string[] = [
      "compact-2026-01-12",
      "context-management-2025-06-27",
      "files-api-2025-04-14",
      "code-execution-2025-08-25",
      "skills-2025-10-02",
      ...(configuredMcpServers.length ? ["mcp-client-2025-11-20"] : []),
    ];

    const existingContainerId = (mainAgentSession.metadataJson as Record<string, unknown> | null)?.containerId as
      | string
      | undefined;

    // Run the agent to completion (non-streaming toolRunner)
    console.log("[headless] calling Anthropic API", {
      model: activeModel,
      thinking: thinkingEnabled,
      effort: prefs.effort,
    });
    const apiStartTime = Date.now();
    const runner = anthropic.beta.messages.toolRunner({
      model: activeModel,
      max_tokens: 32000,
      max_iterations: 30,
      stream: true,
      betas,
      container: {
        ...(existingContainerId ? { id: existingContainerId } : {}),
      },
      metadata: { user_id: input.userId },
      ...(thinkingEnabled ? { thinking: { type: "adaptive" as const } } : {}),
      ...(prefs.effort && prefs.effort !== "high" ? { output_config: { effort: prefs.effort } } : {}),
      system: [
        {
          type: "text" as const,
          text: buildMainAgentSystemPrompt({
            mcpServerNames: configuredMcpServers.map((s) => s.name),
            memoryEnabled: prefs.memory,
            linkedRepo: conversation.repoBinding
              ? {
                  repoFullName: conversation.repoBinding.repoFullName,
                  defaultBranch: conversation.repoBinding.defaultBranch,
                  repoBindingId: conversation.repoBinding.id,
                }
              : null,
            codingSession: activeCodingSession
              ? {
                  status: activeCodingSession.status,
                  sandboxId: activeCodingSession.sandboxId,
                  workspacePath: activeCodingSession.workspacePath,
                  branch: activeCodingSession.branch,
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
        { role: "USER" as const, contentJson: userContent as unknown as Prisma.JsonValue },
      ]),
      tools: [
        ...MAIN_AGENT_SERVER_TOOLS.map((tool) => tool.tool),
        ...filteredTools,
        ...(prefs.memory ? [createMemoryTool(toolCtx)] : []),
        ...configuredMcpServers.map((server) => ({
          type: "mcp_toolset" as const,
          mcp_server_name: server.name,
        })),
      ],
      ...(configuredMcpServers.length ? { mcp_servers: configuredMcpServers } : {}),
    } as Parameters<typeof anthropic.beta.messages.toolRunner>[0]);

    // Drain the streaming toolRunner — must consume iterations for runner.done() to resolve
    for await (const _iteration of runner) {
      // Each iteration is a tool-use round-trip; just drain them
    }

    const finalMessage: BetaMessage = await runner.done();
    console.log("[headless] API completed in", Date.now() - apiStartTime, "ms", {
      model: finalMessage.model,
      stopReason: finalMessage.stop_reason,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });

    // Persist container ID for cross-turn reuse
    const containerId = (finalMessage as unknown as { container?: { id: string } }).container?.id;
    if (containerId) {
      const existingMeta = (mainAgentSession.metadataJson as Record<string, unknown> | null) ?? {};
      await prisma.mainAgentSession
        .update({
          where: { id: mainAgentSession.id },
          data: { metadataJson: { ...existingMeta, containerId } as Prisma.InputJsonValue },
        })
        .catch((err) => console.warn("[headless] container ID persist failed:", err.message));
    }

    // Extract final text (post-tool content only)
    const toolBlockTypes = new Set([
      "tool_use",
      "tool_result",
      "server_tool_use",
      "mcp_tool_use",
      "mcp_tool_result",
      "web_search_tool_result",
      "web_fetch_tool_result",
      "code_execution_tool_result",
      "bash_code_execution_tool_result",
      "text_editor_code_execution_tool_result",
      "tool_search_tool_result",
    ]);
    let lastToolIndex = -1;
    for (let i = finalMessage.content.length - 1; i >= 0; i--) {
      if (toolBlockTypes.has((finalMessage.content[i] as unknown as { type: string }).type)) {
        lastToolIndex = i;
        break;
      }
    }
    const finalContentBlocks =
      lastToolIndex >= 0 ? finalMessage.content.slice(lastToolIndex + 1) : finalMessage.content;
    const finalText = getTextWithCitations(finalContentBlocks);

    // Compute usage and cost
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

    // Persist assistant message + update run
    await Promise.all([
      prisma.message.create({
        data: {
          conversationId: input.conversationId,
          role: "ASSISTANT",
          contentJson: finalMessage.content as unknown as Prisma.InputJsonValue,
        },
      }),
      (async () => {
        const existingRun = await prisma.agentRun.findUnique({
          where: { id: runId },
          select: { metadataJson: true },
        });
        const existingMeta = (existingRun?.metadataJson as Record<string, unknown>) ?? {};
        await prisma.agentRun.update({
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
              ...existingMeta,
              model: finalMessage.model,
              stopReason: finalMessage.stop_reason,
              headless: true,
              usage: {
                inputTokens,
                outputTokens,
                cacheCreationInputTokens: cacheWriteTokens,
                cacheReadInputTokens: cacheReadTokens,
              },
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
      })(),
      prisma.mainAgentSession.update({
        where: { id: mainAgentSession.id },
        data: { anthropicModel: finalMessage.model },
      }),
    ]);

    console.log("[headless] run completed successfully", { runId, textLength: finalText.length, costUsd });
    return { runId, finalText, success: true };
  } catch (error) {
    const message = getMainAgentErrorMessage(error);
    console.error("[headless] Agent run failed:", message);
    Sentry.captureException(error, {
      tags: { runId, userId: input.userId },
      extra: { conversationId: input.conversationId, model: input.preferences?.model },
    });

    // Persist failure state
    await prisma.agentRun
      .update({
        where: { id: runId },
        data: {
          status: RunStatus.FAILED,
          finalText: message,
          metadataJson: { error: message, headless: true } as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      })
      .catch((err) => console.error("[headless] Failed to persist run failure:", err.message));

    return { runId, finalText: message, success: false, error: message };
  }
}
