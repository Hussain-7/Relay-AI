import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { ProviderId } from "@prisma/client";
import type { LanguageModel } from "ai";
import type { SelectedModel } from "@/lib/model-selection";

export function resolveLanguageModel(selection: SelectedModel): LanguageModel {
  if (selection.provider === ProviderId.OPENAI) {
    const provider = createOpenAI({ apiKey: selection.apiKey });
    return provider(selection.modelId);
  }

  if (selection.provider === ProviderId.ANTHROPIC) {
    const provider = createAnthropic({ apiKey: selection.apiKey });
    return provider(selection.modelId);
  }

  throw new Error(`Unsupported provider: ${selection.provider}`);
}
