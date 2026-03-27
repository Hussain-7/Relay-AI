# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Relay AI is a Next.js 16 web application that serves as an AI workspace combining chat, research, file handling, and remote coding sessions. It uses a **two-tier agent architecture**: a main agent (conversational, tool-using) delegates repo-backed coding work to a remote coding agent running in E2B sandboxes via the Claude Agent SDK.

## Commands

- `pnpm dev` — start Next.js dev server
- `pnpm build` — production build
- `pnpm lint` — Biome linter + formatter check
- `pnpm lint:fix` — auto-fix lint issues
- `pnpm format` — format all files with Biome
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm prisma:generate` — regenerate Prisma client after schema changes
- `pnpm prisma:push` — push schema to database (accepts data loss)
- `pnpm inngest:dev` — local Inngest dev server for background coding runs

## Tech Stack

- **Runtime**: Next.js 16 (App Router), React 19 with React Compiler enabled, pnpm
- **Styling**: Tailwind CSS v4 via `@tailwindcss/postcss`
- **Database**: PostgreSQL (Supabase-hosted), Prisma ORM v5
- **AI SDKs**: `@anthropic-ai/sdk` (main agent), `@anthropic-ai/claude-agent-sdk` (coding agent), Vercel AI SDK (`ai` package)
- **Sandbox**: E2B Code Interpreter for remote coding sessions
- **Auth**: Supabase Auth (Google provider); dev mode uses `x-user-id` header via `ALLOW_INSECURE_USER_HEADER`
- **Realtime**: Supabase Realtime broadcast for SSE event fan-out
- **GitHub**: Octokit with GitHub App auth for repo management and PRs
- **Validation**: Zod v4 throughout

## Architecture

### Two-Tier Agent System

1. **Main Agent** (`src/lib/main-agent/`): Runs via Anthropic Messages API with `toolRunner`. Handles conversation, research, web search/fetch, code execution, memory, GitHub ops, and coding session orchestration. Uses beta features: files API, MCP client, server-side tools (web_search, web_fetch, code_execution, tool_search).

2. **Coding Agent** (`src/lib/coding/`): Runs inside E2B sandboxes via Claude Agent SDK (`query()`). Has Claude Code tools (Read, Write, Edit, Glob, Grep, Bash, etc.). The main agent provisions/resumes coding sessions and delegates tasks; the coding agent executes within the sandbox.

### Key Data Flow

- User sends prompt → `POST /api/agent/runs` → `streamMainAgentRun()` creates an `AgentRun`, streams SSE `TimelineEventEnvelope` events back
- Main agent tool calls (memory, GitHub, coding session) execute server-side and emit timeline events
- Coding sessions: main agent calls `coding_agent` → E2B sandbox provisioned → coding agent runs in sandbox
- Events persist to `RunEvent` table and optionally broadcast via Supabase Realtime

### Path Alias

`@/*` maps to `./src/*` (configured in tsconfig.json).

### Source Layout

- `src/app/` — Next.js App Router pages and API routes
- `src/app/api/agent/runs/` — agent run lifecycle (create, get, events SSE, approval)
- `src/app/api/conversations/` — CRUD for conversations and messages
- `src/components/chat-workspace.tsx` — main client-side UI (single large component)
- `src/lib/main-agent/runtime.ts` — main agent streaming loop with Anthropic toolRunner
- `src/lib/main-agent/tools.ts` — client-side tool definitions (memory, GitHub, coding session control)
- `src/lib/main-agent/tool-catalog.ts` — server tool + model catalog registry
- `src/lib/main-agent/mcp.ts` — MCP server configuration from `ANTHROPIC_MCP_SERVERS_JSON`
- `src/lib/coding/session-service.ts` — E2B sandbox lifecycle (provision, resume, reconnect)
- `src/lib/coding/agent-runner.ts` — Claude Agent SDK integration and bootstrap spec
- `src/lib/contracts.ts` — shared DTO types and timeline event definitions
- `src/lib/conversations.ts` — Prisma queries and DTO mapping for conversations
- `src/lib/run-events.ts` — event persistence + Supabase Realtime broadcast
- `src/lib/server-auth.ts` — request user resolution (Supabase JWT or dev header fallback)
- `src/lib/env.ts` — Zod-validated environment config with feature flags (`hasAnthropicApiKey`, `hasE2bConfig`, `hasGitHubAppConfig`)
- `src/lib/prisma.ts` — singleton Prisma client with dev hot-reload caching
- `prisma/schema.prisma` — full data model (conversations, runs, events, coding sessions, repo bindings, memory, GitHub installations)

### Environment

Required: `DATABASE_URL`, `ANTHROPIC_API_KEY`. See `.env.example` for all variables. Feature-gated integrations: E2B (coding), GitHub App (repos/PRs), Supabase (auth/realtime).

### Conventions

- API routes use `requireRequestUser()` for auth, return `Response.json()` with error objects on failure
- All request bodies validated with Zod schemas
- Timeline events use the `TimelineEventEnvelope` type with typed `TimelineEventType` discriminants
- Prisma JSON columns use `Json` type; DTOs use `JsonRecord` (`Record<string, unknown>`)
- ESLint ignores `.agents/` and `.claude/` directories

### Playwright UI Testing

When using the Playwright MCP for UI flow testing:

- **E2E test credentials**: `test@relay-ai.local` / `relay-test-2026` (email/password login via "Sign in with email" on `/login`)
- **Cleanup after testing**: After testing is complete, delete all screenshot files (`*.png`) created in the project root and any Playwright console log files. This ensures a clean repo state. Run: `rm -f *.png`
- **Do not commit** test screenshots or console log artifacts
