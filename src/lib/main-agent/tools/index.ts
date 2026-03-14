export type { ToolRuntimeContext, ToolCatalogEntry } from "./context";

import type { ToolRuntimeContext } from "./context";
import { createChatSearchTool, chatSearchCatalog } from "./chat-search";
import { createGithubCreatePrTool, githubCatalog } from "./github";
import { createCodingSessionStartTool, createCodingSessionStatusTool, createCodingSessionPauseTool, codingSessionCatalog } from "./coding-session";
import { createSandboxExecTool, createSandboxWriteFileTool, sandboxExecCatalog } from "./sandbox-exec";
import { memoryCatalog } from "./memory";

// ── Server tools (executed by the Anthropic API) ──

export const MAIN_AGENT_SERVER_TOOLS = [
  {
    id: "web_search",
    label: "Web search",
    runtime: "main_agent" as const,
    kind: "anthropic_server" as const,
    enabled: true,
    description: "Current web search for research and fact verification.",
    tool: {
      name: "web_search" as const,
      type: "web_search_20250305" as const,
      max_uses: 6,
    },
  },
  {
    id: "web_fetch",
    label: "Web fetch",
    runtime: "main_agent" as const,
    kind: "anthropic_server" as const,
    enabled: true,
    description: "Fetch and cite page contents directly from URLs.",
    tool: {
      name: "web_fetch" as const,
      type: "web_fetch_20260209" as const,
      max_uses: 4,
      citations: { enabled: true },
    },
  },
  {
    id: "code_execution",
    label: "Code execution",
    runtime: "main_agent" as const,
    kind: "anthropic_server" as const,
    enabled: true,
    description: "Short-lived code execution for analysis, parsing, and data work.",
    tool: {
      name: "code_execution" as const,
      type: "code_execution_20260120" as const,
    },
  },
  {
    id: "tool_search_regex",
    label: "Tool search",
    runtime: "main_agent" as const,
    kind: "anthropic_server" as const,
    enabled: true,
    description: "Lets the model discover tools or tool references dynamically.",
    tool: {
      name: "tool_search_tool_regex" as const,
      type: "tool_search_tool_regex_20251119" as const,
    },
  },
];

// ── Custom tools (executed on our server via toolRunner) ──

export function getMainAgentTools(ctx: ToolRuntimeContext) {
  return [
    // TODO: re-enable after coding session testing
    // createChatSearchTool(ctx),
    // createGithubCreatePrTool(ctx),
    // createSandboxExecTool(ctx),
    // createSandboxWriteFileTool(ctx),
    createCodingSessionStartTool(ctx),
    createCodingSessionStatusTool(ctx),
    createCodingSessionPauseTool(ctx),
  ];
}

// ── Unified catalog (auto-derived from tool modules) ──
// This is the single source of truth for the UI tool list.
// Adding a new tool module + its catalog entry here keeps everything in sync.

export const TOOL_CATALOG = [
  // Server tools
  ...MAIN_AGENT_SERVER_TOOLS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    runtime: entry.runtime,
    kind: entry.kind,
    enabled: entry.enabled,
    description: entry.description,
  })),
  // Custom backend tools
  chatSearchCatalog,
  githubCatalog,
  ...codingSessionCatalog,
  sandboxExecCatalog,
  // Disabled tools (available but not wired up)
  memoryCatalog,
];
