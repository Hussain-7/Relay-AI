import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { createSandbox } from "@/lib/e2b-runtime";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";

const createCodingSessionSchema = z.object({
  userId: z.string().optional(),
  runId: z.string().optional(),
  repoFullName: z.string().min(3),
  baseBranch: z.string().min(1).default("main"),
  workingBranch: z.string().optional(),
  autoConnect: z.boolean().default(true),
  timeoutMs: z.number().int().min(60_000).max(7_200_000).default(1_800_000),
});

function deriveWorkingBranch(runId: string | undefined): string {
  if (runId) {
    return `agent/${runId}`;
  }

  return `agent/session-${Date.now()}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = createCodingSessionSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);

    if (body.runId) {
      const run = await prisma.agentRun.findFirst({
        where: {
          id: body.runId,
          userId: auth.userId,
        },
        select: { id: true },
      });

      if (!run) {
        throw new Error("Run not found");
      }
    }

    const session = await prisma.codingSession.create({
      data: {
        userId: auth.userId,
        runId: body.runId,
        repoFullName: body.repoFullName,
        baseBranch: body.baseBranch,
        workingBranch: body.workingBranch ?? deriveWorkingBranch(body.runId),
        status: "created",
      },
    });

    let connectedSandboxId: string | null = null;

    if (body.autoConnect) {
      const sandbox = await createSandbox(body.timeoutMs, {
        userId: auth.userId,
        codingSessionId: session.id,
        runId: body.runId ?? "",
      });

      connectedSandboxId = sandbox.sandboxId;

      await prisma.codingSession.update({
        where: { id: session.id },
        data: {
          sandboxId: sandbox.sandboxId,
          status: "connected",
        },
      });
    }

    if (body.runId) {
      await appendRunEvent(body.runId, "coding.session.created", {
        codingSessionId: session.id,
        sandboxId: connectedSandboxId,
        repoFullName: body.repoFullName,
        baseBranch: body.baseBranch,
        workingBranch: body.workingBranch ?? deriveWorkingBranch(body.runId),
      });
    }

    return NextResponse.json(
      {
        session: {
          ...session,
          sandboxId: connectedSandboxId ?? session.sandboxId,
          status: connectedSandboxId ? "connected" : session.status,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
