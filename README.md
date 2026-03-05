# Endless Dev

End-to-end Next.js agent platform for chat, research, tool-calling, MCP, and remote coding.

## Final Stack

- Next.js 16 (App Router) for UI + backend APIs in one project
- TypeScript + Zod for schema-safe route and tool contracts
- Prisma ORM on Supabase Postgres (DB access through Prisma)
- Supabase Auth (Google OAuth) for app identity/session
- Inngest for background orchestration of long-running coding runs
- AI SDK (`ai`) with:
  - `@ai-sdk/openai`
  - `@ai-sdk/anthropic`
- BYOK encrypted vault (AES-256-GCM) for provider keys and connector secrets
- E2B sandboxes for coding sessions and command execution
  - optional custom template bootstrap via `E2B_TEMPLATE` for preinstalled dependencies
- GitHub App integration for installation-based repo access + draft PR creation
- Workspace packages:
  - `packages/runner`

## Implemented Capabilities

- Normal chat mode (conversation + message persistence)
- Agent mode with tool-calling loop and MCP recommendation/approval flow
- Run events persisted + Realtime fan-out on `run:{runId}` channels (Supabase Realtime broadcast)
- Coding mode with E2B-backed tools:
  - container connect/exec
  - repo clone/search/read/apply-patch/test/status/commit/push
  - draft PR creation
  - delegated executor (`claude`/`codex`) gated by BYOK provider availability
- Core non-coding tools:
  - `web_search`, `http_fetch` (SSRF guardrails), `memory_put/get/search`, `artifacts_read`, `attachments_context`
- Remote MCP call tool (`mcp_remote_call`) for run-approved MCP servers
- Local MCP preflight tool (`mcp_local_preflight`) in coding mode for approved local MCP server bootstrap
- Tool risk gating with persisted `run_approvals` for high-risk actions (shell exec, push, delegated executor, custom gated tools)
- Provider fallback routing when the primary provider/model fails
- Custom Tool Builder runtime:
  - connectors (`rest|graphql|mcp`)
  - custom tools with publish state and versioning
- MCP server management (`remote|local`) with recommendation preflight
- Internal run event ingestion endpoint for external runners
- Inngest-powered async coding dispatch:
  - coding runs are enqueued and return immediately from `/api/agent/runs`
  - background function dispatches `packages/runner` into E2B
  - runner progress streams back as run events
- Unified in-app console (`/`) to operate BYOK, runs, coding sessions, connectors, tools, and MCP servers
  - includes live run event stream panel with realtime subscription and manual refresh

## API Surface

- Auth:
  - `GET /api/auth/google/start`
  - `GET /api/auth/google/callback`
- Chat & Runs:
  - `POST /api/chat`
  - `POST /api/agent/runs`
  - `GET /api/agent/runs/:id`
  - `POST /api/agent/runs/:id/approve`
  - `POST /api/agent/runs/:id/cancel`
  - `GET /api/agent/runs/:id/events`
- Models & BYOK:
  - `POST /api/providers/keys`
  - `GET /api/models`
- MCP:
  - `GET|POST /api/mcp/servers`
  - `PATCH|DELETE /api/mcp/servers/:id`
- Connectors & Custom Tools:
  - `GET|POST /api/connectors`
  - `PATCH|DELETE /api/connectors/:id`
  - `POST /api/connectors/:id/test`
  - `GET|POST /api/tools/custom`
  - `PATCH|DELETE /api/tools/custom/:id`
  - `POST /api/tools/custom/:id/publish`
- Coding:
  - `POST /api/coding/sessions`
  - `POST /api/coding/sessions/:id/connect`
  - `POST /api/coding/sessions/:id/exec`
- GitHub App:
  - `GET /api/github/install-url`
  - `GET /api/github/callback`
- Internal:
  - `POST /api/internal/runs/:id/events`
  - `GET|POST|PUT /api/inngest`
- Health:
  - `GET /api/health`

## Quick Start

```bash
pnpm install
cp .env.example .env.local
pnpm env:check
pnpm prisma:generate
pnpm prisma:push
pnpm dev
# in another terminal, for local background orchestration
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Open `http://localhost:3000` and use the console UI.

See full environment variable mapping in `ENVIRONMENT.md`.

## Auth Notes

- Preferred auth: Supabase bearer token (`Authorization: Bearer <token>`).
- Dev fallback: `x-user-id` header works when `ALLOW_INSECURE_USER_HEADER=true`.
