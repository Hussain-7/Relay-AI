import { Prisma, type Attachment, type CodingSession, type Conversation, type MainAgentSession, type Message, type RepoBinding, type RunApproval, type RunEvent, type AgentRun } from "@prisma/client";

import type { AttachmentDto, CodingSessionDto, ConversationDetailDto, ConversationSummaryDto, MessageDto, RunDto, TimelineEventEnvelope } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";

const conversationDetailInclude = Prisma.validator<Prisma.ConversationInclude>()({
  mainAgentSession: true,
  attachments: {
    orderBy: { createdAt: "asc" },
  },
  messages: {
    orderBy: { createdAt: "asc" },
  },
  runs: {
    orderBy: { createdAt: "asc" },
    include: {
      attachments: {
        orderBy: { createdAt: "asc" },
      },
      approvals: {
        orderBy: { createdAt: "asc" },
      },
      events: {
        orderBy: [{ ts: "asc" }, { id: "asc" }],
      },
      codingSession: {
        include: {
          repoBinding: true,
        },
      },
    },
  },
  codingSessions: {
    orderBy: { updatedAt: "desc" },
    take: 1,
    include: {
      repoBinding: true,
    },
  },
});

type ConversationDetailRecord = Conversation & {
  mainAgentSession: MainAgentSession | null;
  attachments: Attachment[];
  messages: Message[];
  runs: Array<
    AgentRun & {
      attachments: Attachment[];
      approvals: RunApproval[];
      events: RunEvent[];
      codingSession: (CodingSession & {
        repoBinding: RepoBinding | null;
      }) | null;
    }
  >;
  codingSessions: Array<
    CodingSession & {
      repoBinding: RepoBinding | null;
    }
  >;
};

function toJsonRecord(value: unknown) {
  return (value ?? null) as Record<string, unknown> | null;
}

function mapAttachment(attachment: Attachment): AttachmentDto {
  return {
    id: attachment.id,
    kind: attachment.kind,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    sizeBytes: attachment.sizeBytes,
    anthropicFileId: attachment.anthropicFileId,
    createdAt: attachment.createdAt.toISOString(),
    metadataJson: toJsonRecord(attachment.metadataJson),
  };
}

function mapCodingSession(session: (CodingSession & { repoBinding: RepoBinding | null }) | null): CodingSessionDto | null {
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    status: session.status,
    sandboxId: session.sandboxId,
    claudeSdkSessionId: session.claudeSdkSessionId,
    workspacePath: session.workspacePath,
    branch: session.branch,
    lastActiveAt: session.lastActiveAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    repoBinding: session.repoBinding
      ? {
          id: session.repoBinding.id,
          provider: session.repoBinding.provider,
          repoOwner: session.repoBinding.repoOwner,
          repoName: session.repoBinding.repoName,
          repoFullName: session.repoBinding.repoFullName,
          defaultBranch: session.repoBinding.defaultBranch,
          installationId: session.repoBinding.installationId,
          metadataJson: toJsonRecord(session.repoBinding.metadataJson),
        }
      : null,
  };
}

function mapEvents(conversationId: string, runId: string, events: RunEvent[]): TimelineEventEnvelope[] {
  return events.map((event) => ({
    id: event.id,
    runId,
    conversationId,
    type: event.type as TimelineEventEnvelope["type"],
    source: ((event.payloadJson as Record<string, unknown> | null)?.source as TimelineEventEnvelope["source"] | undefined) ?? "system",
    ts: event.ts.toISOString(),
    payload: toJsonRecord(event.payloadJson),
  }));
}

function mapRun(conversationId: string, run: ConversationDetailRecord["runs"][number]): RunDto {
  return {
    id: run.id,
    status: run.status,
    userPrompt: run.userPrompt,
    finalText: run.finalText,
    metadataJson: toJsonRecord(run.metadataJson),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    cancelledAt: run.cancelledAt?.toISOString() ?? null,
    attachments: run.attachments.map(mapAttachment),
    approvals: run.approvals.map((approval) => ({
      id: approval.id,
      kind: approval.kind,
      status: approval.status,
      prompt: approval.title,
      optionsJson: toJsonRecord(approval.proposalJson),
      responseJson: toJsonRecord(approval.responseJson),
      createdAt: approval.createdAt.toISOString(),
      resolvedAt: approval.resolvedAt?.toISOString() ?? null,
    })),
    events: mapEvents(conversationId, run.id, run.events),
    codingSession: run.codingSession
      ? {
          id: run.codingSession.id,
          status: run.codingSession.status,
          workspacePath: run.codingSession.workspacePath,
          branch: run.codingSession.branch,
        }
      : null,
  };
}

function mapMessage(message: Message): MessageDto {
  return {
    id: message.id,
    role: message.role,
    contentJson: message.contentJson,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function ensureConversationForUser(input: {
  conversationId: string;
  userId: string;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      userId: input.userId,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  return conversation;
}

export async function createConversationForUser(input: {
  userId: string;
  id?: string;
  title?: string;
}) {
  return prisma.conversation.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      userId: input.userId,
      title: input.title?.trim() || "New chat",
      mainAgentSession: {
        create: {
          userId: input.userId,
        },
      },
    },
    include: conversationDetailInclude,
  });
}

export async function ensureMainAgentSession(input: {
  conversationId: string;
  userId: string;
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    include: { mainAgentSession: true },
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  if (conversation.userId !== input.userId) {
    throw new Error("Conversation not found.");
  }

  if (conversation.mainAgentSession) {
    return conversation.mainAgentSession;
  }

  return prisma.mainAgentSession.create({
    data: {
      conversationId: input.conversationId,
      userId: input.userId,
    },
  });
}

export async function listConversationSummaries(userId: string): Promise<ConversationSummaryDto[]> {
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      codingSessions: {
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });

  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    defaultMode: conversation.defaultMode,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    latestRunStatus: conversation.runs[0]?.status ?? null,
    latestSnippet: conversation.runs[0]?.finalText ?? conversation.runs[0]?.userPrompt ?? null,
    codingStatus: conversation.codingSessions[0]?.status ?? null,
  }));
}

export async function getConversationDetail(input: {
  conversationId: string;
  userId: string;
}): Promise<ConversationDetailDto> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      userId: input.userId,
    },
    include: conversationDetailInclude,
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const detail = conversation as ConversationDetailRecord;
  const latestCodingSession = detail.codingSessions[0] ?? null;

  return {
    id: detail.id,
    title: detail.title,
    defaultMode: detail.defaultMode,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    mainAgentModel: detail.mainAgentSession?.anthropicModel ?? null,
    attachments: detail.attachments.map(mapAttachment),
    messages: detail.messages.map(mapMessage),
    runs: detail.runs.map((run) => mapRun(detail.id, run)),
    codingSession: mapCodingSession(latestCodingSession),
  };
}

export async function deleteConversationForUser(input: {
  conversationId: string;
  userId: string;
}) {
  const deleted = await prisma.conversation.deleteMany({
    where: {
      id: input.conversationId,
      userId: input.userId,
    },
  });

  if (!deleted.count) {
    throw new Error("Conversation not found.");
  }
}

export async function updateConversationMainModel(input: {
  conversationId: string;
  userId: string;
  model: string;
}) {
  const session = await ensureMainAgentSession({
    conversationId: input.conversationId,
    userId: input.userId,
  });

  await prisma.mainAgentSession.update({
    where: { id: session.id },
    data: {
      anthropicModel: input.model,
    },
  });
}
