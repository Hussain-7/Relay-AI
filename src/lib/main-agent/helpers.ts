import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaMessageParam,
  BetaRequestDocumentBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

import type { AttachmentDto, TimelineEventEnvelope } from "@/lib/contracts";
import { env } from "@/lib/env";
import { getAssistantHistoryContent } from "@/lib/main-agent/citations";
import { serializeSseEvent } from "@/lib/run-events";

const encoder = new TextEncoder();

export function getAnthropicClient() {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
  });
}

export function buildAttachmentBlocks(
  attachments: Array<{ anthropicFileId: string | null; kind: AttachmentDto["kind"]; filename: string }>,
) {
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

export function normalizeAnthropicErrorMessage(message: string) {
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

export function getMainAgentErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return normalizeAnthropicErrorMessage(error.message);
  }

  if (typeof error === "string") {
    return normalizeAnthropicErrorMessage(error);
  }

  return "Unknown main agent error";
}

export function mapMessagesForModel(messages: Array<{ role: string; contentJson: unknown }>): BetaMessageParam[] {
  const mapped = messages.flatMap((message) => {
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

  // Add cache_control breakpoint on the second-to-last message for prompt caching.
  // This caches the conversation history so only the latest turn is uncached.
  if (mapped.length >= 2) {
    const target = mapped[mapped.length - 2]!;
    if (typeof target.content === "string") {
      target.content = [
        {
          type: "text" as const,
          text: target.content,
          cache_control: { type: "ephemeral" as const },
        },
      ];
    } else if (Array.isArray(target.content) && target.content.length > 0) {
      const lastBlock = target.content[target.content.length - 1] as unknown as Record<string, unknown>;
      lastBlock.cache_control = { type: "ephemeral" };
    }
  }

  return mapped;
}

export function inferServerToolName(block: BetaContentBlock) {
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

export function emitSseEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: TimelineEventEnvelope) {
  try {
    controller.enqueue(encoder.encode(serializeSseEvent(event)));
  } catch {
    // Client may have disconnected — event still persists to DB via pendingWrites
  }
}
