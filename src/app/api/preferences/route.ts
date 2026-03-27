import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

const preferencesSchema = z
  .object({
    agent: z
      .object({
        model: z.string(),
        thinking: z.boolean(),
        effort: z.enum(["low", "medium", "high"]),
        memory: z.boolean(),
      })
      .optional(),
    // Extensible — add more sections here later (mcp, ui, etc.)
  })
  .passthrough();

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const profile = await prisma.userProfile.findUnique({
      where: { userId: user.userId },
      select: { preferencesJson: true },
    });

    return Response.json({
      preferences: profile?.preferencesJson ?? {
        agent: { model: "claude-sonnet-4-6", thinking: false, effort: "low", memory: false },
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load preferences." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const body = preferencesSchema.parse(await request.json());

    // Merge with existing preferences (don't overwrite other sections)
    const existing = await prisma.userProfile.findUnique({
      where: { userId: user.userId },
      select: { preferencesJson: true },
    });

    const merged = {
      ...((existing?.preferencesJson as Record<string, unknown>) ?? {}),
      ...body,
    };

    await prisma.userProfile.update({
      where: { userId: user.userId },
      data: { preferencesJson: merged as Prisma.InputJsonValue },
    });

    return Response.json({ preferences: merged });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save preferences." },
      { status: 500 },
    );
  }
}
