import type { TimelineEventType, TimelineSource } from "@/lib/contracts";

export interface ToolRuntimeContext {
  userId: string;
  conversationId: string;
  runId: string;
  emit: (type: "tool.call.completed" | "tool.call.failed", payload: Record<string, unknown>) => Promise<void>;
  /** Emit any timeline event directly to the SSE stream (real-time delivery to client). */
  emitProgress: (type: TimelineEventType, source: TimelineSource, payload?: Record<string, unknown> | null) => void;
}

export interface ToolCatalogEntry {
  id: string;
  label: string;
  runtime: "main_agent" | "coding_agent";
  kind: "anthropic_server" | "anthropic_client" | "custom_backend" | "claude_code_builtin";
  enabled: boolean;
  description: string;
}

export function jsonResult(value: unknown) {
  return JSON.stringify(value, null, 2);
}
