import { env } from "@/lib/env";

export const AVAILABLE_MAIN_MODELS = [
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Balanced speed and intelligence for most chat and agent work.",
  },
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Highest intelligence for complex reasoning and coding.",
  },
] as const;

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
      type: "web_search_20260209" as const,
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

export const TOOL_CATALOG = [
  ...MAIN_AGENT_SERVER_TOOLS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    runtime: entry.runtime,
    kind: entry.kind,
    enabled: entry.enabled,
    description: entry.description,
  })),
  {
    id: "memory",
    label: "Memory",
    runtime: "main_agent" as const,
    kind: "anthropic_client" as const,
    enabled: false,
    description: "Workspace memory persisted in Postgres and exposed as a Claude-style memory tool.",
  },
  {
    id: "chat_search",
    label: "Chat search",
    runtime: "main_agent" as const,
    kind: "custom_backend" as const,
    enabled: true,
    description: "Search prior prompts and responses in the current chat.",
  },
  {
    id: "github",
    label: "GitHub actions",
    runtime: "main_agent" as const,
    kind: "custom_backend" as const,
    enabled: true,
    description: "List, connect, create repos, and open pull requests through the control plane.",
  },
  {
    id: "coding_session",
    label: "Coding session control",
    runtime: "main_agent" as const,
    kind: "custom_backend" as const,
    enabled: true,
    description: "Provision, pause, resume, and inspect remote coding workspaces.",
  },
  {
    id: "bash",
    label: "Bash",
    runtime: "coding_agent" as const,
    kind: "claude_code_builtin" as const,
    enabled: true,
    description: "Claude Code shell access inside the remote coding workspace.",
  },
  {
    id: "text_editor",
    label: "Text editor",
    runtime: "coding_agent" as const,
    kind: "claude_code_builtin" as const,
    enabled: true,
    description: "Claude Code file editing inside the remote coding workspace.",
  },
  {
    id: "computer_use",
    label: "Computer use",
    runtime: "coding_agent" as const,
    kind: "claude_code_builtin" as const,
    enabled: false,
    description: "Reserved for a later sandboxed browser/desktop automation path.",
  },
];

export function getModelCatalog() {
  return {
    mainAgentModel: env.ANTHROPIC_MAIN_MODEL,
    codingAgentModel: env.ANTHROPIC_CODING_MODEL,
    availableMainModels: [...AVAILABLE_MAIN_MODELS],
    builtInTools: TOOL_CATALOG,
  };
}
