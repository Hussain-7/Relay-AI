import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import {
  getOrCreateOnboardingState,
  hasAnyProviderCredential,
} from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";

const updateOnboardingSchema = z.object({
  userId: z.string().optional(),
  currentStep: z.string().min(1).optional(),
  stepData: z.record(z.any()).optional(),
  complete: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthContext(request);
    const state = await getOrCreateOnboardingState(auth.userId);

    return NextResponse.json({
      onboarding: state,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = updateOnboardingSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const current = await getOrCreateOnboardingState(auth.userId);

    if (body.complete) {
      const hasProvider = await hasAnyProviderCredential(auth.userId);
      if (!hasProvider) {
        throw new Error(
          "Complete onboarding blocked: add at least one OpenAI or Anthropic API key first",
        );
      }
    }

    const nextStepData = {
      ...((current.stepDataJson ?? {}) as Record<string, unknown>),
      ...(body.stepData ?? {}),
    };

    const updated = await prisma.onboardingState.update({
      where: { userId: auth.userId },
      data: {
        currentStep: body.currentStep ?? current.currentStep,
        stepDataJson: nextStepData,
        isCompleted: body.complete ? true : current.isCompleted,
        completedAt: body.complete ? new Date() : current.completedAt,
      },
    });

    return NextResponse.json({
      onboarding: updated,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
