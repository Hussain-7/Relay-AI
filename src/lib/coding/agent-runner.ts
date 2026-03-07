import {
  query,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { TimelineEventEnvelope } from "@/lib/contracts";
import { env } from "@/lib/env";
import { CODING_AGENT_SYSTEM_PROMPT } from "@/lib/coding/system-prompt";

const DEFAULT_CODING_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
  "AskUserQuestion",
  "Agent",
] as const;

export interface CodingAgentLaunchInput {
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
  additionalDirectories?: string[];
  permissionMode?: Options["permissionMode"];
  mcpServers?: Options["mcpServers"];
}

export interface CodingAgentBootstrapSpec {
  prompt: string;
  options: Options;
}

function isToolReadOnly(toolName: string) {
  return ["Read", "Glob", "Grep", "WebSearch", "WebFetch"].includes(toolName);
}

export const defaultCodingPermissionHandler: CanUseTool = async (
  toolName,
  _input,
  options,
): Promise<PermissionResult> => {
  if (isToolReadOnly(toolName)) {
    return {
      behavior: "allow",
      toolUseID: options.toolUseID,
    };
  }

  return {
    behavior: "deny",
    message: "This tool call should be routed through the app approval workflow.",
    toolUseID: options.toolUseID,
  };
};

export function createCodingAgentBootstrapSpec(
  input: CodingAgentLaunchInput,
): CodingAgentBootstrapSpec {
  return {
    prompt: input.prompt,
    options: {
      cwd: input.cwd,
      additionalDirectories: input.additionalDirectories,
      resume: input.resumeSessionId,
      permissionMode: input.permissionMode ?? "default",
      tools: { type: "preset", preset: "claude_code" },
      allowedTools: [...DEFAULT_CODING_TOOLS],
      persistSession: true,
      includePartialMessages: true,
      settingSources: ["project", "local"],
      thinking: { type: "enabled", budgetTokens: 4096 },
      model: env.ANTHROPIC_CODING_MODEL,
      systemPrompt: CODING_AGENT_SYSTEM_PROMPT,
      mcpServers: input.mcpServers,
      canUseTool: defaultCodingPermissionHandler,
    },
  };
}

export function createCodingAgentQuery(input: CodingAgentLaunchInput) {
  const spec = createCodingAgentBootstrapSpec(input);

  return query({
    prompt: spec.prompt,
    options: spec.options,
  });
}

export function normalizeCodingAgentMessage(
  message: SDKMessage,
  conversationId: string,
): TimelineEventEnvelope | null {
  if (message.type === "stream_event" && message.event.type === "content_block_delta") {
    if (message.event.delta.type === "text_delta") {
      return {
        id: message.uuid,
        runId: message.session_id,
        conversationId,
        type: "assistant.text.delta",
        source: "coding_agent",
        ts: new Date().toISOString(),
        payload: {
          delta: message.event.delta.text,
          parentToolUseId: message.parent_tool_use_id,
        },
      };
    }

    if (message.event.delta.type === "thinking_delta") {
      return {
        id: message.uuid,
        runId: message.session_id,
        conversationId,
        type: "assistant.thinking.delta",
        source: "coding_agent",
        ts: new Date().toISOString(),
        payload: {
          delta: message.event.delta.thinking,
          parentToolUseId: message.parent_tool_use_id,
        },
      };
    }

    if (message.event.delta.type === "input_json_delta") {
      return {
        id: message.uuid,
        runId: message.session_id,
        conversationId,
        type: "tool.call.input.delta",
        source: "coding_agent",
        ts: new Date().toISOString(),
        payload: {
          delta: message.event.delta.partial_json,
          parentToolUseId: message.parent_tool_use_id,
        },
      };
    }
  }

  if (message.type === "system" && message.subtype === "init") {
    return {
      id: message.uuid,
      runId: message.session_id,
      conversationId,
      type: "coding.session.ready",
      source: "system",
      ts: new Date().toISOString(),
      payload: {
        claudeSdkSessionId: message.session_id,
        cwd: message.cwd,
      },
    };
  }

  if ("result" in message) {
    return {
      id: message.session_id,
      runId: message.session_id,
      conversationId,
      type: "assistant.message.completed",
      source: "coding_agent",
      ts: new Date().toISOString(),
      payload: {
        result: message.result,
        subtype: message.subtype,
      },
    };
  }

  return null;
}
