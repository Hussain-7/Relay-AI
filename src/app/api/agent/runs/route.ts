import {
  ExecutionTarget,
  Prisma,
  ProviderId,
  RunMode,
  RunStatus,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { executeAgentRun } from "@/lib/agent/runtime";
import { resolveAuthContext } from "@/lib/auth-context";
import { createSandbox } from "@/lib/e2b-runtime";
import { errorResponse } from "@/lib/http";
import { recommendMcpServers } from "@/lib/mcp-recommender";
import { prisma } from "@/lib/prisma";
import { queueCodingRun } from "@/lib/coding-run-queue";
import { appendRunEvent } from "@/lib/run-events";

const createRunSchema = z.object({
  userId: z.string().optional(),
  conversationId: z.string().optional(),
  mode: z.enum(["chat", "agent", "coding"]).default("agent"),
  title: z.string().optional(),
  userMessage: z.string().min(1),
  provider: z.enum(["openai", "anthropic"]).optional(),
  modelId: z.string().optional(),
  autoApproveMcp: z.boolean().default(false),
  approvedMcpServerIds: z.array(z.string().min(1)).optional(),
  codingSessionId: z.string().optional(),
  repoFullName: z.string().optional(),
  baseBranch: z.string().default("main"),
  executor: z.enum(["claude", "codex"]).optional(),
  maxMinutes: z.number().int().min(1).max(240).optional(),
});

function mapRunMode(mode: "chat" | "agent" | "coding"): RunMode {
  if (mode === "chat") return RunMode.CHAT;
  if (mode === "coding") return RunMode.CODING;
  return RunMode.AGENT;
}

function mapProvider(
  provider?: "openai" | "anthropic",
): ProviderId | undefined {
  if (!provider) {
    return undefined;
  }
  return provider === "openai" ? ProviderId.OPENAI : ProviderId.ANTHROPIC;
}

function deriveTitle(message: string): string {
  const compact = message.trim().replace(/\s+/g, " ");
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}

export async function POST(request: NextRequest) {
  try {
    const body = createRunSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const runMode = mapRunMode(body.mode);

    const conversation = body.conversationId
      ? await prisma.conversation.findFirst({
          where: { id: body.conversationId, userId: auth.userId },
        })
      : await prisma.conversation.create({
          data: {
            userId: auth.userId,
            title: body.title?.trim() || deriveTitle(body.userMessage),
            defaultMode: runMode,
          },
        });

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        contentJson: { text: body.userMessage },
      },
    });

    const run = await prisma.agentRun.create({
      data: {
        userId: auth.userId,
        conversationId: conversation.id,
        mode: runMode,
        executionTarget:
          runMode === RunMode.CODING
            ? ExecutionTarget.E2B
            : ExecutionTarget.VERCEL,
        status: RunStatus.CREATED,
      },
    });

    await appendRunEvent(run.id, "run.created", {
      mode: run.mode,
      conversationId: conversation.id,
    });

    let codingSessionId: string | undefined = body.codingSessionId;
    if (runMode === RunMode.CODING) {
      if (codingSessionId) {
        const session = await prisma.codingSession.findFirst({
          where: {
            id: codingSessionId,
            userId: auth.userId,
          },
          select: { id: true },
        });
        if (!session) {
          throw new Error("Coding session not found");
        }
      } else {
        if (!body.repoFullName) {
          throw new Error(
            "repoFullName is required for coding runs when no codingSessionId is provided",
          );
        }

        const sandbox = await createSandbox(1_800_000, {
          userId: auth.userId,
          runId: run.id,
        });

        const workingBranch = `agent/${run.id}`;
        const codingSession = await prisma.codingSession.create({
          data: {
            userId: auth.userId,
            runId: run.id,
            repoFullName: body.repoFullName,
            baseBranch: body.baseBranch,
            workingBranch,
            sandboxId: sandbox.sandboxId,
            status: "connected",
          },
        });

        codingSessionId = codingSession.id;

        await appendRunEvent(run.id, "coding.session.auto_created", {
          codingSessionId: codingSession.id,
          sandboxId: codingSession.sandboxId,
          repoFullName: codingSession.repoFullName,
        });
      }
    }

    if (codingSessionId) {
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          approvedTools: {
            codingSessionId,
          } as Prisma.InputJsonValue,
        },
      });
    }

    if (runMode !== RunMode.CHAT) {
      const servers = await prisma.mCPServer.findMany({
        where: {
          userId: auth.userId,
          status: "active",
        },
      });

      const recommendations = recommendMcpServers(body.userMessage, servers);
      const approvedServerIds = new Set(body.approvedMcpServerIds ?? []);

      const requiresApproval =
        recommendations.length > 0 &&
        !body.autoApproveMcp &&
        approvedServerIds.size === 0;
      if (requiresApproval) {
        const approval = await prisma.runApproval.create({
          data: {
            runId: run.id,
            kind: "mcp_servers",
            proposalJson: {
              recommendations,
            } as unknown as Prisma.InputJsonValue,
            status: "PENDING",
          },
        });

        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: RunStatus.AWAITING_APPROVAL,
          },
        });

        await appendRunEvent(run.id, "approval.required", {
          approvalId: approval.id,
          kind: approval.kind,
          recommendations,
        });

        return NextResponse.json({
          status: "approval_required",
          runId: run.id,
          conversationId: conversation.id,
          approval: {
            id: approval.id,
            kind: approval.kind,
            proposal: approval.proposalJson,
          },
        });
      }

      const selectedApprovals =
        approvedServerIds.size > 0
          ? servers
              .filter((server) => approvedServerIds.has(server.id))
              .map((server) => server.id)
          : recommendations.map((recommendation) => recommendation.id);

      if (selectedApprovals.length > 0) {
        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            approvedMcp: {
              serverIds: selectedApprovals,
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    const runPrompt = codingSessionId
      ? `${body.userMessage}\n\nCoding context: Always use codingSessionId=${codingSessionId} for coding tools.`
      : body.userMessage;

    if (runMode === RunMode.CODING) {
      const queueResult = await queueCodingRun({
        runId: run.id,
        userId: auth.userId,
        apiBaseUrl: process.env.APP_URL ?? request.nextUrl.origin,
        prompt: runPrompt,
        preferredProvider: mapProvider(body.provider),
        preferredExecutor: body.executor,
        maxMinutes: body.maxMinutes,
      });

      return NextResponse.json({
        status: "running",
        runId: run.id,
        conversationId: conversation.id,
        codingSessionId,
        queueResult,
      });
    }

    const runForExecution = await prisma.agentRun.findUnique({
      where: { id: run.id },
    });

    if (!runForExecution) {
      throw new Error("Run not found");
    }

    let result;
    try {
      result = await executeAgentRun({
        run: runForExecution,
        userId: auth.userId,
        userMessage: runPrompt,
        preferredProvider: mapProvider(body.provider),
        preferredModelId: body.modelId,
      });
    } catch (executionError) {
      const message =
        executionError instanceof Error
          ? executionError.message
          : String(executionError);
      if (message.startsWith("Approval required")) {
        const approval = await prisma.runApproval.findFirst({
          where: {
            runId: run.id,
            status: "PENDING",
          },
          orderBy: { createdAt: "desc" },
        });

        return NextResponse.json({
          status: "approval_required",
          runId: run.id,
          conversationId: conversation.id,
          codingSessionId,
          approval: approval
            ? {
                id: approval.id,
                kind: approval.kind,
                proposal: approval.proposalJson,
              }
            : null,
        });
      }
      throw executionError;
    }

    return NextResponse.json({
      status: "completed",
      runId: run.id,
      conversationId: conversation.id,
      codingSessionId,
      result,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
