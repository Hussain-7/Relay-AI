import { z } from "zod";

const booleanLike = z
  .string()
  .optional()
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MAIN_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_TITLE_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_CODING_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_MCP_SERVERS_JSON: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  E2B_API_KEY: z.string().optional(),
  E2B_TEMPLATE: z.string().optional(),
  E2B_TEMPLATE_ID: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_STATE_SECRET: z.string().optional(),
  RUNNER_EVENT_TOKEN: z.string().optional(),
  ALLOW_INSECURE_USER_HEADER: booleanLike,
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export function hasAnthropicApiKey() {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function hasSupabaseRealtimeConfig() {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasE2bConfig() {
  return Boolean(env.E2B_API_KEY);
}

export function hasGitHubAppConfig() {
  return Boolean(
    env.GITHUB_APP_ID &&
      env.GITHUB_APP_PRIVATE_KEY &&
      env.GITHUB_APP_PRIVATE_KEY.includes("BEGIN") &&
      env.GITHUB_APP_SLUG,
  );
}
