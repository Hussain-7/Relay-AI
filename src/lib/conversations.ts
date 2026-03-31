import type {
  AgentRun,
  Attachment,
  CodingSession,
  Conversation,
  MainAgentSession,
  Message,
  Prisma,
  RepoBinding,
  RunApproval,
  RunEvent,
} from "@/generated/prisma/client";

import type {
  AttachmentDto,
  CodingSessionDto,
  ConversationDetailDto,
  ConversationSummaryDto,
  MessageDto,
  RunDto,
  TimelineEventEnvelope,
} from "@/lib/contracts";
import { prisma } from "@/lib/prisma";

const attachmentFields = {
  id: true,
  conversationId: true,
  runId: true,
  kind: true,
  filename: true,
  mediaType: true,
  sizeBytes: true,
  anthropicFileId: true,
  storageUrl: true,
  metadataJson: true,
  createdAt: true,
} satisfies Prisma.AttachmentSelect;

const conversationDetailInclude = {
  mainAgentSession: true,
  repoBinding: true,
  attachments: {
    select: attachmentFields,
    orderBy: { createdAt: "asc" as const },
  },
  messages: {
    orderBy: { createdAt: "asc" as const },
  },
  runs: {
    orderBy: { createdAt: "asc" as const },
    include: {
      attachments: {
        select: attachmentFields,
        orderBy: { createdAt: "asc" as const },
      },
      approvals: {
        orderBy: { createdAt: "asc" as const },
      },
      events: {
        orderBy: [{ ts: "asc" as const }, { id: "asc" as const }],
      },
      codingSession: {
        include: {
          repoBinding: true,
        },
      },
    },
  },
  codingSessions: {
    orderBy: { updatedAt: "desc" as const },
    take: 1,
    include: {
      repoBinding: true,
    },
  },
} satisfies Prisma.ConversationInclude;

type AttachmentRecord = Attachment;

type ConversationDetailRecord = Conversation & {
  mainAgentSession: MainAgentSession | null;
  repoBinding: RepoBinding | null;
  attachments: AttachmentRecord[];
  messages: Message[];
  runs: Array<
    AgentRun & {
      attachments: AttachmentRecord[];
      approvals: RunApproval[];
      events: RunEvent[];
      codingSession:
        | (CodingSession & {
            repoBinding: RepoBinding | null;
          })
        | null;
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

function mapAttachment(attachment: AttachmentRecord): AttachmentDto {
  return {
    id: attachment.id,
    kind: attachment.kind,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    sizeBytes: attachment.sizeBytes,
    anthropicFileId: attachment.anthropicFileId,
    storageUrl: attachment.storageUrl,
    createdAt: attachment.createdAt.toISOString(),
    metadataJson: toJsonRecord(attachment.metadataJson),
  };
}

function mapCodingSession(
  session: (CodingSession & { repoBinding: RepoBinding | null }) | null,
): CodingSessionDto | null {
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
    source:
      ((event.payloadJson as Record<string, unknown> | null)?.source as TimelineEventEnvelope["source"] | undefined) ??
      "system",
    ts: event.ts.toISOString(),
    payload: toJsonRecord(event.payloadJson),
  }));
}

function mapRun(conversationId: string, run: ConversationDetailRecord["runs"][number]): RunDto {
  const inputAttachments = run.attachments.filter((a) => {
    const meta = a.metadataJson as Record<string, unknown> | null;
    return !meta?.source || meta.source === "user_upload";
  });
  const outputAttachments = run.attachments.filter((a) => {
    const source = (a.metadataJson as Record<string, unknown> | null)?.source;
    return source === "skill_output" || source === "image_generation";
  });

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
    attachments: inputAttachments.map(mapAttachment),
    outputAttachments: outputAttachments.map(mapAttachment),
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

export async function ensureConversationForUser(input: { conversationId: string; userId: string }) {
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
  repoBindingId?: string;
}) {
  return prisma.conversation.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      userId: input.userId,
      title: input.title?.trim() || "New chat",
      ...(input.repoBindingId ? { repoBindingId: input.repoBindingId } : {}),
      mainAgentSession: {
        create: {
          userId: input.userId,
        },
      },
    },
    include: conversationDetailInclude,
  });
}

export async function ensureMainAgentSession(input: { conversationId: string; userId: string }) {
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
      repoBinding: {
        select: { repoFullName: true },
      },
    },
  });

  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    defaultMode: conversation.defaultMode,
    isStarred: conversation.isStarred,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    latestRunStatus: conversation.runs[0]?.status ?? null,
    latestSnippet: conversation.runs[0]?.finalText ?? conversation.runs[0]?.userPrompt ?? null,
    codingStatus: conversation.codingSessions[0]?.status ?? null,
    repoFullName: conversation.repoBinding?.repoFullName ?? null,
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
    isStarred: detail.isStarred,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    mainAgentModel: detail.mainAgentSession?.anthropicModel ?? null,
    repoBinding: detail.repoBinding
      ? {
          id: detail.repoBinding.id,
          provider: detail.repoBinding.provider,
          repoOwner: detail.repoBinding.repoOwner,
          repoName: detail.repoBinding.repoName,
          repoFullName: detail.repoBinding.repoFullName,
          defaultBranch: detail.repoBinding.defaultBranch,
          installationId: detail.repoBinding.installationId,
          metadataJson: toJsonRecord(detail.repoBinding.metadataJson),
        }
      : null,
    attachments: detail.attachments.map(mapAttachment),
    messages: detail.messages.map(mapMessage),
    runs: detail.runs.map((run) => mapRun(detail.id, run)),
    codingSession: mapCodingSession(latestCodingSession),
  };
}

export async function deleteConversationForUser(input: { conversationId: string; userId: string }) {
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

export async function updateConversationFields(input: {
  conversationId: string;
  userId: string;
  title?: string;
  isStarred?: boolean;
  mainAgentModel?: string;
  repoBindingId?: string | null;
}) {
  await prisma.$transaction(async (tx) => {
    // Build conversation-level updates in a single query
    const convData: Record<string, unknown> = {};
    if (input.title) convData.title = input.title;
    if (input.isStarred !== undefined) {
      convData.isStarred = input.isStarred;
      convData.updatedAt = new Date();
    }
    if (input.repoBindingId !== undefined) convData.repoBindingId = input.repoBindingId;

    if (Object.keys(convData).length > 0) {
      await tx.conversation.updateMany({
        where: { id: input.conversationId, userId: input.userId },
        data: convData,
      });
    }

    // Model lives on MainAgentSession — a separate table
    if (input.mainAgentModel) {
      const conversation = await tx.conversation.findUnique({
        where: { id: input.conversationId },
        include: { mainAgentSession: true },
      });

      if (!conversation || conversation.userId !== input.userId) {
        throw new Error("Conversation not found.");
      }

      const session =
        conversation.mainAgentSession ??
        (await tx.mainAgentSession.create({
          data: { conversationId: input.conversationId, userId: input.userId },
        }));

      await tx.mainAgentSession.update({
        where: { id: session.id },
        data: { anthropicModel: input.mainAgentModel },
      });
    }
  });
}
