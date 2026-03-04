import { ProviderId } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MODEL_SEEDS = [
  {
    provider: ProviderId.OPENAI,
    modelId: "gpt-5.2",
    displayName: "GPT-5.2",
    tier: "best",
    supportsTools: true,
  },
  {
    provider: ProviderId.OPENAI,
    modelId: "gpt-5.2-mini",
    displayName: "GPT-5.2 Mini",
    tier: "fast",
    supportsTools: true,
  },
  {
    provider: ProviderId.ANTHROPIC,
    modelId: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    tier: "best",
    supportsTools: true,
  },
  {
    provider: ProviderId.ANTHROPIC,
    modelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    tier: "fast",
    supportsTools: true,
  },
];

const ALIAS_SEEDS = [
  { alias: "best", provider: ProviderId.OPENAI, modelId: "gpt-5.2" },
  { alias: "fast", provider: ProviderId.OPENAI, modelId: "gpt-5.2-mini" },
  { alias: "best", provider: ProviderId.ANTHROPIC, modelId: "claude-opus-4-6" },
  {
    alias: "fast",
    provider: ProviderId.ANTHROPIC,
    modelId: "claude-sonnet-4-6",
  },
];

export async function ensureModelCatalogSeeded() {
  for (const model of MODEL_SEEDS) {
    await prisma.modelCatalog.upsert({
      where: {
        provider_modelId: {
          provider: model.provider,
          modelId: model.modelId,
        },
      },
      update: {
        displayName: model.displayName,
        tier: model.tier,
        supportsTools: model.supportsTools,
        enabled: true,
      },
      create: {
        provider: model.provider,
        modelId: model.modelId,
        displayName: model.displayName,
        tier: model.tier,
        supportsTools: model.supportsTools,
        enabled: true,
      },
    });
  }

  for (const alias of ALIAS_SEEDS) {
    await prisma.modelAlias.upsert({
      where: {
        alias_provider: {
          alias: alias.alias,
          provider: alias.provider,
        },
      },
      update: {
        modelId: alias.modelId,
      },
      create: alias,
    });
  }
}
