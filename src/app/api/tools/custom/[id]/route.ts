import { ExecutionTarget, ToolPublishState } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  userId: z.string().optional(),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  policy: z.record(z.any()).optional(),
  inputSchema: z.record(z.any()).optional(),
  outputSchema: z.record(z.any()).optional(),
  executionTarget: z.enum(["vercel", "e2b"]).optional(),
  connectorId: z.string().min(1).optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function mapExecutionTarget(value: "vercel" | "e2b"): ExecutionTarget {
  return value === "vercel" ? ExecutionTarget.VERCEL : ExecutionTarget.E2B;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const body = patchSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const { id } = await context.params;

    const existing = await prisma.customTool.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Custom tool not found" },
        { status: 404 },
      );
    }

    if (body.connectorId) {
      const connector = await prisma.connectorConfig.findFirst({
        where: {
          id: body.connectorId,
          userId: auth.userId,
        },
        select: { id: true },
      });

      if (!connector) {
        throw new Error("Connector not found");
      }
    }

    const updated = await prisma.customTool.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.description ? { description: body.description } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.policy ? { policyJson: body.policy } : {}),
        ...(body.inputSchema ? { inputSchemaJson: body.inputSchema } : {}),
        ...(body.outputSchema ? { outputSchemaJson: body.outputSchema } : {}),
        ...(body.executionTarget
          ? { executionTarget: mapExecutionTarget(body.executionTarget) }
          : {}),
        ...(body.connectorId ? { connectorId: body.connectorId } : {}),
      },
    });

    return NextResponse.json({ tool: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await resolveAuthContext(request);
    const { id } = await context.params;

    const existing = await prisma.customTool.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Custom tool not found" },
        { status: 404 },
      );
    }

    await prisma.customTool.update({
      where: { id },
      data: {
        enabled: false,
        publishState: ToolPublishState.DISABLED,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
