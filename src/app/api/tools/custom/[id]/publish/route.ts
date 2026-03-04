import { ToolPublishState } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const publishSchema = z.object({
  userId: z.string().optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const rawBody = await request.text();
    const body = rawBody ? publishSchema.parse(JSON.parse(rawBody)) : {};

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

    const latestVersion = await prisma.customToolVersion.findFirst({
      where: { toolId: existing.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const nextVersion = (latestVersion?.version ?? 0) + 1;

    await prisma.customToolVersion.create({
      data: {
        toolId: existing.id,
        version: nextVersion,
        specJson: {
          name: existing.name,
          description: existing.description,
          inputSchema: existing.inputSchemaJson,
          outputSchema: existing.outputSchemaJson,
          executionTarget: existing.executionTarget,
          policy: existing.policyJson,
        },
      },
    });

    const tool = await prisma.customTool.update({
      where: { id: existing.id },
      data: { publishState: ToolPublishState.PUBLISHED },
    });

    return NextResponse.json({ tool, publishedVersion: nextVersion });
  } catch (error) {
    return errorResponse(error);
  }
}
