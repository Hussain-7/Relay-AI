import { Prisma, ProviderId, RunStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { executeAgentRun } from "@/lib/agent/runtime";
import { resolveAuthContext } from "@/lib/auth-context";
import { queueCodingRun } from "@/lib/coding-run-queue";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";

const approveSchema = z.object({
  userId: z.string().optional(),
  approvalId: z.string().optional(),
  approve: z.boolean().default(true),
  approvedMcpServerIds: z.array(z.string().min(1)).optional(),
  provider: z.enum(["openai", "anthropic"]).optional(),
  modelId: z.string().optional(),
  executor: z.enum(["claude", "codex"]).optional(),
  maxMinutes: z.number().int().min(1).max(240).optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function mapProvider(
  provider?: "openai" | "anthropic",
): ProviderId | undefined {
  if (!provider) {
    return undefined;
  }
  return provider === "openai" ? ProviderId.OPENAI : ProviderId.ANTHROPIC;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = approveSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const { id } = await context.params;

    const run = await prisma.agentRun.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const pendingApprovals = await prisma.runApproval.findMany({
      where: {
        runId: run.id,
        status: "PENDING",
        ...(body.approvalId ? { id: body.approvalId } : {}),
      },
    });

    if (!body.approve) {
      if (pendingApprovals.length > 0) {
        await prisma.runApproval.updateMany({
          where: {
            id: { in: pendingApprovals.map((approval) => approval.id) },
          },
          data: {
            status: "REJECTED",
            resolvedAt: new Date(),
          },
        });
      }

      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.CANCELLED,
          cancelledAt: new Date(),
          endedAt: new Date(),
        },
      });

      await appendRunEvent(run.id, "approval.rejected", {
        approvals: pendingApprovals.map((approval) => approval.id),
      });

      return NextResponse.json({
        status: "cancelled",
        runId: run.id,
      });
    }

    if (pendingApprovals.length > 0) {
      await prisma.runApproval.updateMany({
        where: { id: { in: pendingApprovals.map((approval) => approval.id) } },
        data: {
          status: "APPROVED",
          resolvedAt: new Date(),
        },
      });
    }

    const approvedMcpServerIds =
      body.approvedMcpServerIds ??
      pendingApprovals.flatMap((approval) => {
        const proposal = approval.proposalJson as {
          recommendations?: Array<{ id: string }>;
        };
        return (
          proposal.recommendations?.map(
            (recommendation) => recommendation.id,
          ) ?? []
        );
      });

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.CREATED,
        approvedMcp:
          approvedMcpServerIds.length > 0
            ? ({
                serverIds: approvedMcpServerIds,
              } as Prisma.InputJsonValue)
            : (run.approvedMcp ?? undefined),
      },
    });

    await appendRunEvent(run.id, "approval.approved", {
      approvals: pendingApprovals.map((approval) => approval.id),
      approvedMcpServerIds,
    });

    const lastUserMessage = await prisma.message.findFirst({
      where: {
        conversationId: run.conversationId,
        role: "user",
      },
      orderBy: { createdAt: "desc" },
    });

    if (!lastUserMessage) {
      throw new Error("No user message found to resume run");
    }

    const content = lastUserMessage.contentJson as { text?: string };
    if (!content?.text) {
      throw new Error("Last user message does not contain text content");
    }

    const refreshedRun = await prisma.agentRun.findUnique({
      where: { id: run.id },
    });

    if (!refreshedRun) {
      throw new Error("Run not found");
    }

    const runToolContext = (refreshedRun.approvedTools ?? null) as {
      codingSessionId?: string;
    } | null;
    const resumedPrompt = runToolContext?.codingSessionId
      ? `${content.text}\n\nCoding context: Always use codingSessionId=${runToolContext.codingSessionId} for coding tools.`
      : content.text;

    if (refreshedRun.mode === "CODING") {
      const queueResult = await queueCodingRun({
        runId: refreshedRun.id,
        userId: auth.userId,
        apiBaseUrl: process.env.APP_URL ?? request.nextUrl.origin,
        prompt: resumedPrompt,
        preferredProvider: mapProvider(body.provider),
        preferredExecutor: body.executor,
        maxMinutes: body.maxMinutes,
      });

      return NextResponse.json({
        status: "running",
        runId: refreshedRun.id,
        queueResult,
      });
    }

    let result;
    try {
      result = await executeAgentRun({
        run: refreshedRun,
        userId: auth.userId,
        userMessage: resumedPrompt,
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
      result,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
