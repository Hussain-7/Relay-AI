import type { ApprovalStatus, AttachmentKind, CodingSessionStatus, ConversationMode, MessageRole, RunStatus } from "@prisma/client";

export type TimelineSource = "user" | "main_agent" | "coding_agent" | "system";

export type TimelineEventType =
  | "conversation.updated"
  | "run.started"
  | "assistant.text.delta"
  | "assistant.text.intermediate"
  | "assistant.message.completed"
  | "assistant.thinking.delta"
  | "tool.call.started"
  | "tool.call.input.delta"
  | "tool.call.completed"
  | "tool.call.failed"
  | "approval.requested"
  | "approval.resolved"
  | "coding.session.created"
  | "coding.session.ready"
  | "coding.session.paused"
  | "coding.session.resumed"
  | "coding.agent.running"
  | "run.completed"
  | "run.failed";

export type JsonRecord = Record<string, unknown>;

export interface TimelineEventEnvelope {
  id: string;
  runId: string;
  conversationId: string;
  type: TimelineEventType;
  source: TimelineSource;
  ts: string;
  payload: JsonRecord | null;
}

export interface AttachmentDto {
  id: string;
  kind: AttachmentKind;
  filename: string;
  mediaType: string;
  sizeBytes: number | null;
  anthropicFileId: string | null;
  createdAt: string;
  metadataJson: JsonRecord | null;
}

export interface ApprovalDto {
  id: string;
  kind: string;
  status: ApprovalStatus;
  prompt: string;
  optionsJson: JsonRecord | null;
  responseJson: JsonRecord | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface RepoBindingDto {
  id: string;
  provider: "GITHUB";
  repoOwner: string;
  repoName: string;
  repoFullName: string;
  defaultBranch: string | null;
  installationId: string | null;
  metadataJson: JsonRecord | null;
}

export interface CodingSessionDto {
  id: string;
  status: CodingSessionStatus;
  sandboxId: string | null;
  claudeSdkSessionId: string | null;
  workspacePath: string | null;
  branch: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
  repoBinding: RepoBindingDto | null;
}

export interface RunDto {
  id: string;
  status: RunStatus;
  userPrompt: string;
  finalText: string | null;
  metadataJson: JsonRecord | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  attachments: AttachmentDto[];
  approvals: ApprovalDto[];
  events: TimelineEventEnvelope[];
  codingSession: Pick<CodingSessionDto, "id" | "status" | "workspacePath" | "branch"> | null;
}

export interface MessageDto {
  id: string;
  role: MessageRole;
  contentJson: unknown;
  createdAt: string;
}

export interface ConversationSummaryDto {
  id: string;
  title: string;
  defaultMode: ConversationMode;
  createdAt: string;
  updatedAt: string;
  latestRunStatus: RunStatus | null;
  latestSnippet: string | null;
  codingStatus: CodingSessionStatus | null;
}

export interface ConversationDetailDto {
  id: string;
  title: string;
  defaultMode: ConversationMode;
  createdAt: string;
  updatedAt: string;
  mainAgentModel: string | null;
  attachments: AttachmentDto[];
  messages: MessageDto[];
  runs: RunDto[];
  codingSession: CodingSessionDto | null;
}

export interface ModelCatalogDto {
  mainAgentModel: string;
  codingAgentModel: string;
  availableMainModels: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  builtInTools: Array<{
    id: string;
    label: string;
    runtime: "main_agent" | "coding_agent";
    kind: "anthropic_server" | "anthropic_client" | "custom_backend" | "claude_code_builtin";
    enabled: boolean;
    description: string;
  }>;
}
