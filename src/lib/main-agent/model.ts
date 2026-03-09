import { env } from "@/lib/env";
import { TOOL_CATALOG } from "./tools";

export const AVAILABLE_MAIN_MODELS = [
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Balanced speed and intelligence for most chat and agent work.",
  },
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Highest intelligence for complex reasoning and coding.",
  },
] as const;

export function getModelCatalog() {
  return {
    mainAgentModel: env.ANTHROPIC_MAIN_MODEL,
    codingAgentModel: env.ANTHROPIC_CODING_MODEL,
    availableMainModels: [...AVAILABLE_MAIN_MODELS],
    builtInTools: TOOL_CATALOG,
  };
}
