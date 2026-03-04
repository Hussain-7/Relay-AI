import { ExecutionTarget } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const createToolSchema = z.object({
  userId: z.string().optional(),
  connectorId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.any()),
  outputSchema: z.record(z.any()),
  executionTarget: z.enum(["vercel", "e2b"]),
  policy: z.record(z.any()).default({}),
  enabled: z.boolean().default(true),
});

function mapExecutionTarget(value: "vercel" | "e2b"): ExecutionTarget {
  return value === "vercel" ? ExecutionTarget.VERCEL : ExecutionTarget.E2B;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthContext(request);

    const tools = await prisma.customTool.findMany({
      where: { userId: auth.userId },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        connector: {
          select: {
            id: true,
            name: true,
            connectorType: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ tools });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createToolSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);

    const connector = await prisma.connectorConfig.findFirst({
      where: {
        id: body.connectorId,
        userId: auth.userId,
      },
    });

    if (!connector) {
      throw new Error("Connector not found");
    }

    const tool = await prisma.customTool.create({
      data: {
        userId: auth.userId,
        connectorId: body.connectorId,
        name: body.name,
        description: body.description,
        inputSchemaJson: body.inputSchema,
        outputSchemaJson: body.outputSchema,
        executionTarget: mapExecutionTarget(body.executionTarget),
        policyJson: body.policy,
        enabled: body.enabled,
      },
    });

    await prisma.customToolVersion.create({
      data: {
        toolId: tool.id,
        version: 1,
        specJson: {
          name: body.name,
          description: body.description,
          inputSchema: body.inputSchema,
          outputSchema: body.outputSchema,
          executionTarget: body.executionTarget,
          policy: body.policy,
        },
      },
    });

    return NextResponse.json({ tool }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
