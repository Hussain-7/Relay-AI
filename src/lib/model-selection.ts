import { ProviderId } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveProviderCredentials } from "@/lib/provider-credentials";

export interface SelectedModel {
  provider: ProviderId;
  modelId: string;
  apiKey: string;
}

type PickModelInput = {
  userId: string;
  preferredProvider?: ProviderId;
  preferredModelId?: string;
  requireTools?: boolean;
};

const QUALITY_TIER_SCORE: Record<string, number> = {
  best: 2,
  fast: 1,
};

export async function selectModelForUser(
  input: PickModelInput,
): Promise<SelectedModel> {
  const credentials = await getActiveProviderCredentials(input.userId);
  if (credentials.length === 0) {
    throw new Error(
      "No active provider key found. Add OpenAI or Anthropic key first.",
    );
  }

  const credentialMap = new Map(
    credentials.map((row) => [row.provider, row.apiKey]),
  );
  const providerFilter = input.preferredProvider
    ? [input.preferredProvider]
    : [...credentialMap.keys()];

  const candidateModels = await prisma.modelCatalog.findMany({
    where: {
      enabled: true,
      provider: { in: providerFilter },
      ...(input.preferredModelId ? { modelId: input.preferredModelId } : {}),
      ...(input.requireTools ? { supportsTools: true } : {}),
    },
  });

  if (candidateModels.length === 0) {
    throw new Error(
      "No eligible model found for selected provider configuration",
    );
  }

  const sorted = candidateModels.sort((a, b) => {
    const scoreDiff =
      (QUALITY_TIER_SCORE[b.tier] ?? 0) - (QUALITY_TIER_SCORE[a.tier] ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.modelId.localeCompare(b.modelId);
  });

  for (const model of sorted) {
    const apiKey = credentialMap.get(model.provider);
    if (apiKey) {
      return {
        provider: model.provider,
        modelId: model.modelId,
        apiKey,
      };
    }
  }

  throw new Error(
    "No decrypted provider credential available for selected model",
  );
}
