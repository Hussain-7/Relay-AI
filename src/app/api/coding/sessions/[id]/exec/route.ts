import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { execInSandbox } from "@/lib/e2b-runtime";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";

const execSchema = z
  .object({
    userId: z.string().optional(),
    command: z.string().min(1).optional(),
    commands: z.array(z.string().min(1)).optional(),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().min(1000).max(1_800_000).default(120_000),
    envs: z.record(z.string()).optional(),
  })
  .refine(
    (value) => value.command || (value.commands && value.commands.length > 0),
    {
      message: "Provide either command or commands",
    },
  );

type RouteContext = {
  params: Promise<{ id: string }>;
};

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+\/(\s|$)/i,
  /\bmkfs\./i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bkillall\s+-9\b/i,
];

function assertCommandAllowed(command: string): void {
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Forbidden command pattern detected: ${pattern}`);
    }
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = execSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const { id } = await context.params;

    const session = await prisma.codingSession.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Coding session not found" },
        { status: 404 },
      );
    }

    if (!session.sandboxId) {
      return NextResponse.json(
        {
          error:
            "Coding session is not connected. Call /api/coding/sessions/:id/connect first.",
        },
        { status: 409 },
      );
    }

    const commandList =
      body.commands && body.commands.length > 0
        ? body.commands
        : [body.command!];
    const results = [];

    for (const command of commandList) {
      assertCommandAllowed(command);
      const result = await execInSandbox(session.sandboxId, {
        command,
        cwd: body.cwd,
        timeoutMs: body.timeoutMs,
        envs: body.envs,
      });
      results.push(result);
    }

    if (session.runId) {
      await appendRunEvent(session.runId, "coding.session.exec", {
        codingSessionId: session.id,
        commandCount: commandList.length,
        commands: commandList,
        exitCodes: results.map((result) => result.exitCode),
      });
    }

    return NextResponse.json({
      codingSessionId: session.id,
      sandboxId: session.sandboxId,
      results,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
