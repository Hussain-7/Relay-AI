# Endless Dev: Agent Harness Plan (Next.js + AI SDK + BYOK + MCP + Remote Coding)

Last updated: 2026-03-04

## Implementation Status (Current Repo)

- Implemented in this codebase:
  - Next.js unified UI + API app at repo root.
  - Prisma schema for users, BYOK credentials, connectors/tools, runs/events/approvals, MCP servers, GitHub installations, coding sessions, artifacts.
  - Google OAuth endpoints via Supabase Auth (`/api/auth/google/start`, `/api/auth/google/callback`).
  - BYOK key vault API with encryption and provider key validation (`/api/providers/keys`).
  - Model catalog seeding and provider-gated model listing (`/api/models`).
  - Chat endpoint (`/api/chat`) and complete run lifecycle APIs (`/api/agent/runs*`).
  - MCP recommendation + approval preflight integrated into run creation.
  - Connector + Custom Tool Builder APIs (CRUD/test/publish/versioning).
  - MCP server management APIs (`/api/mcp/servers*`).
  - Coding session APIs with E2B connect/exec (`/api/coding/sessions*`).
  - GitHub App install/callback APIs (`/api/github/*`) and draft PR tool path in runtime.
  - Internal runner event ingest API (`/api/internal/runs/:id/events`).
  - Inngest-backed async coding orchestration:
    - coding runs enqueue background jobs (`agent/coding-run.requested`)
    - Inngest function dispatches runner into E2B
    - runner lifecycle callbacks update run terminal states and final assistant messages
  - Agent runtime with core tools:
    - `web_search`
    - `http_fetch` (SSRF/host guardrails)
    - `memory_put`, `memory_get`, `memory_search`
    - `artifacts_read`, `attachments_context`
    - `mcp_remote_call` for approved remote MCP servers
    - `mcp_local_preflight` for approved local MCP server bootstrap in coding mode
    - `e2b_container_connect`, `e2b_container_exec`
    - repo tools (`clone`, `checkout`, `search`, `read_file`, `apply_patch`, `run_tests`, `status_diff`, `commit`, `push_branch`, `create_draft_pr`)
    - delegated executor tool (`delegate_codegen` for `claude`/`codex`, gated by BYOK provider availability).
  - Tool telemetry events (`tool.started`, `tool.completed`, `tool.failed`) persisted and emitted during runs.
  - Tool approval gating persisted in `run_approvals` for high-risk actions (shell exec, push, delegated executor, gated/destructive custom tools).
  - Provider fallback execution path when primary model/provider fails and alternate BYOK provider is available.
  - Realtime run event fan-out via Supabase Realtime broadcast channel `run:{runId}` (best-effort).
  - In-app console UI at `/` for operating all major capabilities.
  - In-app run event stream viewer with realtime subscription + manual refresh.
- Validation status:
  - `pnpm prisma:generate` passes
  - `pnpm typecheck` passes
  - `pnpm lint` passes
  - `pnpm build` passes

## 1) Scope

- Build a single Next.js (UI + API) codebase that supports:
  - Google-authenticated user accounts for app sign-in and session management.
  - Normal chat (fast streaming, minimal friction).
  - Agentic mode (tool-calling loop, MCP, approvals, memory, run events).
  - Remote coding mode (GitHub repo checkout, edits, tests, commits, draft PRs).
  - Custom Tool Builder for managing connectors and internal API tools with schemas, auth, and policy controls.
- Make the baseline capability set strong for a general agent:
  - research-first (`web.search`),
  - coding in sandboxed filesystem/process environments (E2B),
  - MCP tool connectivity (remote + local).
- Exclude Ephor-specific business/library functionality; keep generic agent mechanics.

## 2) Hard Decisions (Locked)

- App framework: Next.js (App Router) for UI + backend APIs in one repo.
- Providers (v1): OpenAI + Anthropic via AI SDK; coding mode also supports delegated CLI executors inside E2B.
- Streaming: use AI SDK streaming primitives; no provider-specific SSE chunk conversion layer.
- BYOK: per-user provider keys; provider/model/executor availability is gated by which keys the user has added.
- Model policy: quality-first router with fallback across connected providers.
- GitHub auth: GitHub App install (least privilege) for repo write + PR creation.
- App auth: Google OAuth sign-in enabled via Supabase Auth.
- PR behavior: create Draft PR by default.
- MCP activation UX: dynamic recommend + user approve (per run/session).
- Custom Tool Builder: first-class feature for registering/managing custom APIs and MCP-backed tools.
- Tool safety: policy-based auto-run for safe actions + risk gating approvals.
- Data access: Prisma is the primary ORM and schema/migration layer.
- Supabase usage: Postgres host + Auth + Storage + Realtime; avoid direct Supabase DB CRUD in core services.
- Default tool baseline: always include `web.search` for research in Agent/Coding modes.
- E2B command baseline: include `e2b.container.connect` + `e2b.container.exec` as first-class coding tools.
- E2B boot model: use a custom E2B template alias/id (`E2B_TEMPLATE`) so coding sandboxes start preconfigured with major dependencies.
- Git workflow in sandbox: prefer E2B `sandbox.git` APIs for clone/push auth flows; keep shell git fallback for unsupported edge cases.
- Deployment: Next.js on Vercel serverless.
- Sandbox: E2B is used only when required for:
  - GitHub repo operations (clone/edit/test/commit/push/PR).
  - Local MCP servers that require cloning/installing/running via stdio.

## 3) Modes and Execution Targets

### 3.1 Chat Mode (Default)

- Goal: fast normal interaction.
- Runs on: Vercel only.
- Tools: none by default (pure LLM). Optional: safe, non-sandbox tools can be enabled later, but must not require E2B.

### 3.2 Agent Mode (Tool Loop, Non-Coding)

- Goal: generic agent behavior (tool loop + MCP + approvals + memory) without local filesystem/process requirements.
- Runs on: Vercel only.
- Tools allowed: `web.search`, remote MCP tools, safe HTTP fetch, memory tools, attachments/context tools.
- Constraints: enforce serverless-friendly budgets (max steps + wall time) so runs do not exceed Vercel limits.

### 3.3 Coding Mode (Repo + Local MCP)

- Goal: remote coding session with repo checkout and PR automation; local MCP stdio support.
- Runs on: E2B sandbox.
- Tools allowed: repo tools, shell tools, local MCP stdio tools, delegated CLI executor tools, plus all Agent Mode tools.
- UX: chat + live logs + diff view + one-click Draft PR.

## 4) Architecture Overview

- Next.js app (Vercel):
  - UI pages (chat, settings, coding session view, connectors/tool builder).
  - API routes for auth, runs, approvals, provider keys, MCP servers, custom connectors/tools, GitHub app install.
- Inngest:
  - background job execution for coding-run dispatch and retries.
  - webhook endpoint at `/api/inngest`.
- Prisma + Supabase:
  - Prisma: all database models, queries, and migrations.
  - Supabase Postgres: underlying relational database.
  - Supabase Auth/Storage/Realtime: auth identity, artifact storage, live event streaming.
  - Rule: core backend services use Prisma for DB writes/reads instead of direct Supabase table client calls.
- E2B:
  - Ephemeral sandbox per coding session/run with TTL.
  - Runs the agent loop for coding mode and pushes events back to Supabase.

## 5) Repo Structure (Greenfield)

Recommended monorepo layout (still "one place", one repo):

- apps/web
  - Next.js UI + API routes
- packages/runner
  - E2B sandbox entrypoint CLI that runs coding-mode agent loop and emits run events

(Alternative if you want simpler tooling: keep everything under one Next.js repo and add a `src/runner` build target. Default here is the monorepo layout to keep serverless vs runner code clean.)

## 6) Data Model (Prisma + Supabase Postgres)

Minimum tables:

- user_profiles
  - user_id, email, full_name, avatar_url, created_at, updated_at
- connector_configs
  - id, user_id, name, connector_type (rest|graphql|mcp), base_url, auth_type, config_json, status, created_at, updated_at
- connector_secrets
  - id, connector_id, encrypted_secret_blob, key_version, last_validated_at, created_at, updated_at
- custom_tools
  - id, user_id, connector_id, name, description, input_schema_json, output_schema_json, execution_target, policy_json, enabled, created_at, updated_at
- custom_tool_versions
  - id, tool_id, version, spec_json, created_at
- provider_credentials
  - user_id, provider, encrypted_key_blob, status, validated_at, created_at
- model_catalog
  - provider, model_id, display_name, supports_tools, tier, enabled
- model_aliases
  - alias, provider, model_id
- conversations
  - user_id, title, default_mode, created_at
- messages
  - conversation_id, role, content_json, model_id, created_at
- agent_runs
  - user_id, conversation_id, mode, execution_target, status, approved_mcp, approved_tools, usage_json, final_message_json, cancelled_at, created_at, ended_at
- run_events
  - run_id, ts, type, payload_json
- run_approvals
  - run_id, kind, proposal_json, status, resolved_at
- mcp_servers
  - user_id, server_type (remote|local), config_json, status, created_at
- github_installations
  - user_id, installation_id, account_json, created_at
- coding_sessions
  - user_id, run_id, repo_full_name, base_branch, working_branch, sandbox_id, pr_url, status, created_at
- artifacts
  - user_id, run_id, kind, storage_path, meta_json, created_at

Access model:

- Prisma enforces tenant scoping in backend service queries.
- Supabase Auth is source of user identity (Google OAuth provider enabled).
- Optional defense-in-depth: keep RLS enabled on exposed tables/channels where applicable.

## 7) BYOK Vault (Encryption)

- Store provider keys encrypted at rest.
- Encryption scheme: AES-256-GCM with key versioning.
- Master key: Vercel env var (base64) with rotation support.
- Never return raw keys to the client after save.
- Validate key on save (provider ping or lightweight model call) and store `validated_at`.

## 8) Providers + Model Routing

### 8.1 Provider Adapters

Define `ProviderAdapter`:

- id: 'openai' | 'anthropic'
- createModel(modelId, apiKey): returns AI SDK model instance
- validateKey(apiKey): returns ok/error
- capabilities: supportsTools, supportsStreaming

Implement adapters using AI SDK provider packages (exact package names may vary; use current AI SDK docs at implementation).

### 8.2 Model Catalog + Aliases

- Maintain a curated model catalog (DB seeded).
- Define aliases:
  - openai:best, openai:fast
  - anthropic:best, anthropic:fast
- Quality-first router:
  - pick the best connected provider model that supports required capabilities
  - fallback to the other connected provider only on failure/capability mismatch

### 8.3 Provider Gating Rules (BYOK)

- Minimum requirement: at least one provider key (`OpenAI` or `Anthropic`) is required before starting model-backed chat/agent/coding runs.
- If user has only OpenAI key:
  - show only OpenAI models, route only OpenAI model calls
  - enable `Codex` delegated CLI executor in E2B
- If user has only Anthropic key:
  - show only Anthropic models, route only Anthropic model calls
  - enable `Claude` delegated CLI executor in E2B
- If user has both:
  - show both; default routing uses quality-first aliases
  - both delegated executors are available, selected by run policy

## 9) Tooling System (Extensible)

### 9.1 Tool Plugin Interface

`ToolPlugin` fields:

- name, description
- inputSchema (zod)
- riskLevel: safe | gated | destructive
- execution: vercel | e2b | either
- run(ctx, input) -> result

### 9.2 Tool Policy Engine

- Auto-run safe reads and standard checks.
- Require explicit approval for:
  - destructive operations (git push without PR flow, deleting files, force operations)
  - arbitrary shell commands
  - high-risk network operations
- All approvals are persisted in `run_approvals` and drive run pause/resume.

### 9.3 Core Tool Set (v1)

Vercel/either tools:

- web.search (default research tool; provider-backed web search strategy)
- http.fetch (SSRF-safe, size/time limits, allowlist/denylist)
- memory.get / memory.put / memory.search (Supabase-backed)
- attachments.context (normalize UI attachments into prompt context)
- artifacts.read (load stored artifacts)

E2B-only tools:

- e2b.container.connect (create or attach to sandbox session; returns `containerSessionId`)
- e2b.container.exec (run one or multiple commands in connected container; streams stdout/stderr and exit codes)
- repo.clone / repo.checkout
- repo.search / repo.read_file
- repo.apply_patch
- repo.run_tests
- shell.run (policy-gated allowlist)
- repo.commit / repo.push_branch
- repo.create_draft_pr
- repo.status_diff
- delegate.codegen (runs external coding CLI inside sandbox and returns structured result)

### 9.4 Custom Tool Builder (Connectors + APIs)

- Builder UI supports:
  - create connector (`rest`, `graphql`, or `mcp`)
  - define tool metadata, input/output schemas, and execution target (`vercel` or `e2b`)
  - attach auth strategy (api_key, bearer, oauth2, none)
  - configure policy (`safe`, `gated`, `destructive`) and network allowlist
- Runtime behavior:
  - custom tools are compiled into `ToolPlugin` definitions at run start
  - secrets are resolved just-in-time from encrypted `connector_secrets`
  - each invocation is audit-logged with connector id/tool id and latency/status
- Governance:
  - tool versioning and publish state (`draft` -> `published`)
  - disable/rollback tool versions without deleting historical run references

## 10) MCP Integration (Remote + Local)

### 10.1 Server Types

- Remote MCP:
  - executed from Vercel
  - transports: SSE/HTTP as supported by AI SDK MCP client
- Local MCP (stdio):
  - executed inside E2B only
  - supports cloning/installing MCP server code when required

### 10.2 Dynamic Recommend + Approve Flow

- Step A: MCP recommender (LLM) proposes needed MCP servers/tools given:
  - user query, connected MCP servers, basic tool descriptions
- Step B: API returns approval payload if needed:
  - proposed servers, reasons, tool list, risk notes
- Step C: after user approval:
  - approved MCP toolsets are materialized into the tool registry for that run/session

### 10.3 Local MCP Preflight (E2B)

For each local MCP server config:

- ensure repo code is available (clone or pull)
- run install steps (config-defined)
- start MCP via stdio transport (spawned by MCP client)

## 11) Agent Harness (Generic Loop)

- One shared run state machine is currently implemented in app runtime (`src/lib/agent/runtime.ts`).
- Future hardening item:
  - extract shared run state machine to a dedicated package if/when multiple runtimes need independent versioning.
- Uses AI SDK tool-calling with:
  - maxSteps
  - onToolCall/onToolResult/onFinish hooks to emit `run_events`
- Coding mode execution strategy:
  - `native`: model uses first-class repo tools (`repo.apply_patch`, `repo.run_tests`, etc.)
  - `delegated`: model calls `delegate.codegen` which invokes `claude` or `codex` CLI in E2B and consumes structured outputs
- Container command strategy:
  - connect once at run/session start using `e2b.container.connect`
  - reuse the same `containerSessionId` across all tool calls for low latency and filesystem continuity
  - prefer `e2b.container.exec` batch mode for related commands to reduce round trips
- Context management:
  - truncation policy
  - optional summarization when exceeding budgets (v1 can ship truncation-only; summarization can be phase 2)

Budgets:

- Chat: maxSteps=1
- Agent (Vercel): maxSteps ~10 and wall-time budget to fit Vercel
- Coding (E2B): maxSteps ~30 with longer wall-time

Cancellation:

- API sets `agent_runs.cancelled_at`
- runner checks before each step and aborts promptly

## 12) Eventing + UI Rendering

- Persist structured events in `run_events`.
- Publish via Supabase Realtime channel `run:{runId}`.
- UI subscribes and renders:
  - assistant deltas/messages
  - tool start/result
  - approval requested/granted
  - repo diff ready
  - PR created

## 13) Identity + GitHub Integration

### 13.1 Google Auth (App Sign-In)

- Auth provider: Google OAuth through Supabase Auth.
- Session model:
  - browser obtains Supabase session via Google login
  - Next.js APIs validate session/JWT and map to internal `user_id`
- First-login bootstrap:
  - create or upsert `user_profiles` from Auth identity metadata.

### 13.2 GitHub App Integration (Repo Access)

- Endpoints:
  - GET /api/github/install-url
  - GET /api/github/callback
- Store installation_id per user.
- For repo actions:
  - mint short-lived installation access tokens
  - pass token to E2B runner via env vars for the duration of the run
- Draft PR content:
  - summary of intent
  - list of changed files
  - tests run + results
  - risks and follow-ups

## 14) API Surface (v1)

- GET /api/auth/google/start
  - starts Google OAuth flow (or redirects to Supabase auth endpoint)
- GET /api/auth/google/callback
  - handles OAuth callback and session bootstrap
- POST /api/chat
  - returns streaming response (AI SDK)
  - stores final message in `messages`
- POST /api/agent/runs
  - creates run, performs MCP recommendation preflight
  - returns either `approval_required` or `runId`
- POST /api/agent/runs/:id/approve
  - records approvals and resumes run
- POST /api/agent/runs/:id/cancel
- GET /api/agent/runs/:id
- GET /api/agent/runs/:id/events
- POST /api/providers/keys
- GET /api/models
- POST /api/mcp/servers
- GET /api/connectors
- POST /api/connectors
- PATCH /api/connectors/:id
- DELETE /api/connectors/:id
- POST /api/connectors/:id/test
- GET /api/tools/custom
- POST /api/tools/custom
- PATCH /api/tools/custom/:id
- DELETE /api/tools/custom/:id
- POST /api/tools/custom/:id/publish
- POST /api/coding/sessions
  - creates coding session; starts/attaches E2B sandbox
- POST /api/coding/sessions/:id/connect
  - returns `containerSessionId` for tool runtime attachment
- POST /api/coding/sessions/:id/exec
  - executes command(s) in the connected E2B session and returns structured output

## 15) Testing and Acceptance

Unit:

- BYOK gating for providers/models
- key encryption roundtrip + versioning
- tool policy decisions
- MCP recommender output validation
- model router selection + fallback

Integration:

- chat streaming endpoint
- agent run approve/resume path
- remote MCP tool invocation (no sandbox)
- coding session run in E2B with diff + draft PR
- custom connector test + custom tool invocation path with schema validation

E2E:

- Google login creates/updates app user profile and opens chat app successfully
- user creates connector + publishes custom tool + agent successfully invokes it in a run
- OpenAI-only key shows only OpenAI
- Anthropic-only key shows only Anthropic
- both keys enable quality-first router + fallback
- coding task produces a draft PR with reviewable diff

## 16) Phased Delivery

Phase 1:

- Prisma schema/migrations on Supabase Postgres + Supabase Auth (Google enabled) + provider vault + model catalog/aliases
- Chat UI + /api/chat

Phase 2:

- Agent mode on Vercel: tool registry, remote MCP, approvals, run events UI
- Custom Tool Builder (connectors + custom API tools) UI and APIs

Phase 3:

- E2B coding mode: runner, repo tools, local MCP stdio, diff + draft PR UX

Phase 4:

- Hardening: allowlists, rate limits, audit logs, sandbox cleanup, cost controls

## 17) E2B Code-Change Execution Strategy (Detailed)

### 17.1 Which agent runs inside E2B

- The coding agent is our own Node runner process from `packages/runner`, not a separate third-party coding app.
- The runner is currently a standalone execution worker (`packages/runner`) that is dispatched by the API/Inngest layer.
- Model calls inside E2B still use AI SDK with user-selected/quality-routed OpenAI or Anthropic models.

### 17.2 Sandbox bootstrap and credentials

- `POST /api/coding/sessions` creates `coding_session` + `agent_run`, then starts an E2B sandbox.
- Sandbox creation is template-first:
  - use `E2B_TEMPLATE` (or `E2B_TEMPLATE_ID`) when configured
  - fallback to default E2B base template only when no custom template is provided
- The API injects short-lived secrets into sandbox env only for that run:
  - GitHub installation token
  - provider API key (decrypted server-side just in time)
  - short-lived backend event-ingest token (runner posts events to API, API persists via Prisma and publishes Realtime)
- Runner command starts with `runId`, `sessionId`, `repo`, `baseBranch`, `workingBranch`.

### 17.3 Repo checkout and workspace prep

- Runner clones target repo into sandbox workspace and checks out `baseBranch`.
- For host-managed coding tools, clone/push should use E2B git integration (`sandbox.git.clone`, `sandbox.git.push`) with token auth fields instead of embedding secrets in URLs.
- Existing repo refresh operations can continue to use shell `git fetch/pull` where it is simpler/more compatible.
- Runner creates/uses `workingBranch` (default: `agent/<runId>`).
- Runner captures baseline commit SHA and publishes initial `run_events` (`repo.cloned`, `branch.created`).

### 17.4 How code changes are actually applied

- Primary edit tool is `repo.apply_patch` with unified diff payload from the model.
- Tool validation before applying:
  - reject path traversal or writes outside workspace
  - reject binary/lockfile edits unless explicitly allowed by policy
  - enforce max patch size and per-step file count
- Patch apply flow:
  - try `git apply --3way --whitespace=nowarn`
  - if failed, return structured error + hunk diagnostics to the model for retry
  - if applied, emit changed-file summary event
- Follow-up tools (`repo.read_file`, `repo.search`, `repo.status_diff`) are used by the model to verify edits before commit.

### 17.5 Validation and commit pipeline

- Runner executes configured checks (if present): lint/typecheck/tests in policy-approved order.
- If checks fail, tool result includes failing command output and agent loops to fix.
- Commit is only allowed when policy requirements are met (or explicit user override is approved).
- Commit message format:
  - first line: concise intent
  - body: files changed + test status + run id metadata

### 17.6 Push and draft PR creation

- `repo.push_branch` uses GitHub installation token over HTTPS remote.
- `repo.create_draft_pr` calls GitHub API with:
  - title from user task + final change summary
  - body with test results, risks, and follow-up notes
  - base = requested base branch, head = working branch
- PR URL is persisted to `coding_sessions.pr_url` and emitted as `run_events`.

### 17.7 Failure handling and cleanup

- On cancellation/failure, runner:
  - persists terminal error event
  - uploads logs/diff artifact
  - stops local MCP child processes
  - destroys sandbox by TTL/explicit teardown
- Retry policy:
  - transient network/provider errors retry with backoff
  - patch-logic retries stay in-agent loop with structured feedback, not blind reruns

### 17.8 Delegated CLI executor path (`claude` / `codex`)

- Purpose:
  - allow full "agent finishes task before returning" behavior by delegating code execution to a sandbox CLI agent process
- Runner tool: `delegate.codegen`
  - Inputs:
    - `executor`: `claude` or `codex`
    - `prompt`: task prompt
    - `workingDir`: repo path in sandbox
    - `maxMinutes`, `maxTurns`, `expectedChecks`
  - Outputs (structured JSON):
    - `status`: `completed` | `needs_followup` | `failed`
    - `summary`
    - `changed_files`
    - `commands_run`
    - `tests_run`
    - `needs_followup_reason` (optional)
- Command strategy in E2B:
  - Claude executor uses `claude -p --permission-mode bypassPermissions --verbose "<task>"`
  - Codex executor uses equivalent non-interactive command mode configured for full task execution
- Security and control:
  - `bypassPermissions` allowed only inside isolated E2B sandbox
  - hard timeout, max token budget, max output bytes, and cancellation signal enforcement
- Orchestration loop:
  - after delegated run, orchestrator verifies with `git diff` + required checks
  - if result is `needs_followup`, orchestrator starts another delegated iteration with bounded retry count
  - commit/push/PR is still performed through our controlled repo tools and policy checks

### 17.9 Persistent E2B container command loop (speed path)

- At coding-run start, runner opens or reuses one container session and stores `containerSessionId` in `coding_sessions`.
- `e2b.container.exec` is the main command primitive for iterative coding loops:
  - supports single-command mode for deterministic steps
  - supports multi-command batch mode for fast query/build/test cycles
- Command result contract (always structured):
  - `command`, `cwd`, `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut`
- Guardrails:
  - allowed cwd confined to workspace
  - command allow/deny policy enforced before execution
  - hard timeout + max output bytes per command
- This keeps the main agent fast and stateful while preserving safety and full filesystem continuity.

### 17.10 Custom E2B template baseline (pre-setup container)

- Build one shared template for coding runs that includes:
  - git, node, pnpm, build essentials, common language runtimes needed for target repos
  - delegated executor prerequisites (`claude` and/or `codex` CLI setup paths as policy allows)
  - optional local MCP runtime dependencies (stdio servers commonly used)
- Include template `start` and `ready` commands so sandboxes are considered ready before runner launch.
- Version template with tags and promote to `:stable` only after smoke tests.
- Keep template config in infra docs and expose selected template via env (`E2B_TEMPLATE`) in app runtime.

### 17.11 Git credential model in sandbox

- GitHub App installation token remains the source of repo auth for clone/push/PR.
- Token handling rules:
  - mint short-lived token server-side
  - pass only for the active run/session
  - do not persist token in DB or logs
  - prefer E2B git auth options (`username/password`) over token-in-URL remotes
- PR creation still happens via GitHub API from trusted backend using the same installation identity.

## 18) Product UX Flow Redesign (New Priority)

This section defines the target product experience to replace the current single-page console/debug UI.

### 18.1 Target User Journey

1. Public landing page on first domain visit.
2. User clicks `Get Started` and sees Google auth.
3. First successful auth routes to onboarding wizard.
4. User completes required setup (BYOK at minimum), optional setup (GitHub, connectors, MCP), and finishes onboarding.
5. User lands in full chat workspace:

- left sidebar for conversations + `New Chat`
- main chat pane with assistant/user turns
- agent activity/timeline view for tool calls, approvals, and step outputs

6. Connectors/MCP/provider keys live under profile/settings (not on main chat surface).

### 18.2 App Information Architecture (Next.js routes)

- `/(public)/page.tsx`
  - marketing/landing page.
- `/(auth)/sign-in/page.tsx`
  - Google sign-in entry.
- `/(onboarding)/page.tsx`
  - guarded wizard for first-time users.
- `/(app)/chat/page.tsx`
  - default new chat view.
- `/(app)/chat/[conversationId]/page.tsx`
  - existing conversation view.
- `/(app)/settings/page.tsx`
  - profile + settings shell with tabs:
    - `providers` (BYOK)
    - `models`
    - `github`
    - `connectors`
    - `mcp`
    - `tools`
    - `account`

### 18.3 UX Requirements by Surface

#### Landing page

- Polished product-first page with clear value proposition, trust/feature sections, and primary CTA (`Continue with Google`).
- Do not expose internal debug forms.

#### Auth + Onboarding

- If no valid session: redirect to sign-in.
- If session exists and onboarding is incomplete: hard redirect to onboarding wizard.
- Onboarding wizard steps:
  - Step 1: Provider keys (required: at least one of OpenAI/Anthropic).
  - Step 2: Model defaults/preferences (optional but recommended).
  - Step 3: GitHub app connect (optional, needed for coding PR flow).
  - Step 4: Connectors and MCP quick setup (optional skip).
  - Step 5: Review + finish.
- Persist progress so onboarding can resume.

#### Chat workspace

- Left rail:
  - conversation list (recent, searchable, paginated).
  - `New Chat` button.
  - profile/settings menu entry.
- Main pane:
  - message thread.
  - composer (mode switcher chat/agent/coding, model selector, submit).
  - streaming assistant response.
- Agent activity pane (inline or right drawer):
  - run phases (`created`, `running`, `awaiting approval`, `completed`, `failed`).
  - tool call cards with:
    - tool name
    - input preview
    - output preview/status
    - duration and timestamp
  - approval cards with approve/reject actions.
  - coding-specific cards for repo prep, delegated executor logs, diff summary, PR link.

### 18.4 API/Backend Work Needed for New UX

- Conversation APIs for sidebar UX:
  - `GET /api/conversations` (list with pagination/search)
  - `POST /api/conversations` (create)
  - `PATCH /api/conversations/:id` (rename/archive metadata)
  - `DELETE /api/conversations/:id` (soft delete/archive)
- Message fetch API:
  - `GET /api/conversations/:id/messages` (paginated history)
- Onboarding state:
  - add persisted onboarding table/state (`isCompleted`, `currentStep`, `completedAt`, step metadata).
  - add `GET/POST /api/onboarding`.
- Keep existing run APIs and events; reshape client consumption for timeline cards.

### 18.5 UI Component Plan

- `LandingPage`, `AuthGate`, `OnboardingWizard`.
- `AppShell` with `Sidebar`, `TopBar`, `ProfileMenu`.
- `ConversationList`, `ChatComposer`, `MessageThread`.
- `RunTimeline` with typed cards:
  - `RunStatusCard`
  - `ToolCallCard`
  - `ApprovalCard`
  - `CodingProgressCard`
  - `ErrorCard`
- `SettingsModal` or `SettingsPage` with tabbed sections.

### 18.6 Data and State Plan

- Client query cache (React Query or equivalent) for:
  - conversations
  - messages
  - active run
  - run events
  - onboarding state
- Realtime:
  - keep Supabase channel `run:{runId}` subscription.
  - merge realtime events into timeline state with idempotent event map.

### 18.7 Migration Plan (from current console UI)

1. Introduce new route groups and layout shells without removing current APIs.
2. Ship landing + auth gate + onboarding guard.
3. Ship chat workspace using existing run/chat endpoints.
4. Move connector/MCP/tool forms into settings pages.
5. Remove `AppConsole` debug surface from root.
6. Keep an internal `/dev/console` route only for engineering diagnostics (non-production).

### 18.8 Delivery Phases and Acceptance Criteria

Phase UX-1 (Routing + guards)

- Done when:
  - unauthenticated users always see landing/sign-in flow.
  - first-time users always land in onboarding.
  - returning users land directly in chat workspace.

Phase UX-2 (Onboarding wizard)

- Done when:
  - onboarding progress persists across reloads.
  - at least one provider key is required to complete onboarding.
  - user can skip optional GitHub/connectors/MCP steps.

Phase UX-3 (Chat workspace)

- Done when:
  - sidebar lists chats and supports new chat creation.
  - messages load per selected conversation.
  - streaming responses and run timeline are visible in one workflow.

Phase UX-4 (Agentic visibility + approvals)

- Done when:
  - tool calls and approvals are rendered as structured timeline cards.
  - approval actions can be taken directly from timeline cards.
  - coding run progress (repo prep/delegate/diff/PR) is clearly visible.

Phase UX-5 (Settings consolidation + cleanup)

- Done when:
  - providers/models/connectors/MCP/tools are managed only in settings.
  - root no longer shows debug forms.
  - all existing backend checks still pass.

### 18.9 Skill-Guided Standards (for implementation quality)

- `web-design-guidelines` standards will be enforced during UI implementation and review:
  - accessibility-first controls (labels, aria, keyboard, focus-visible)
  - semantic structure and predictable navigation patterns
  - motion safety (`prefers-reduced-motion`) and no `transition: all`
  - resilient content handling (truncate/clamp/break long text)
- `vercel-react-best-practices` will guide React/Next architecture:
  - eliminate async waterfalls in route/layout data loading
  - split heavy workspace panels with dynamic imports
  - reduce rerenders in chat thread + timeline via memoized boundaries
  - keep server/client boundaries clean to reduce hydration mismatch risk
- `vercel-composition-patterns` will shape component APIs:
  - avoid boolean-prop explosion for chat/timeline variants
  - use compound components for chat shell and settings shell
  - lift shared state into providers and keep leaf components declarative

### 18.10 Skill Coverage Matrix (All Local Skills Reviewed)

The following local skills were reviewed and mapped to this UX re-architecture plan:

- `web-design-guidelines`
  - UI quality and accessibility compliance gates for landing, onboarding, chat shell, timeline cards.
- `building-components`
  - component API design (controlled/uncontrolled patterns, accessibility contracts, composable structure).
- `vercel-composition-patterns`
  - app shell and chat/timeline compound component patterns to avoid boolean-prop sprawl.
- `vercel-react-best-practices`
  - Next.js/React performance constraints (avoid waterfalls, split heavy panels, minimize rerenders).
- `ai-elements`
  - candidate base primitives for conversation/message/composer components where it accelerates delivery.
- `streamdown`
  - markdown + code + diagram rendering plan for assistant output and tool payload previews.
- `ai-sdk`
  - streaming + tool-call event handling model for chat/timeline UX behavior.
- `inngest-setup`
  - background workflow endpoint/client setup validation for async coding runs.
- `inngest-events`
  - event naming/schema normalization for timeline rendering fidelity.
- `inngest-steps`
  - step granularity and deterministic step design for coding orchestration.
- `inngest-flow-control`
  - concurrency/rate/debounce guardrails for coding run dispatch and retries.
- `inngest-middleware`
  - cross-cutting logging, trace metadata injection, and error instrumentation in workflows.
- `inngest-durable-functions`
  - durable execution/retry/idempotency design for async run lifecycle.
- `prisma-database-setup`
  - schema change safety and environment setup for onboarding/conversation expansion.
- `prisma-cli`
  - migration execution flow and CLI discipline.
- `prisma-client-api`
  - query patterns for conversation list/messages/history APIs.
- `prisma-driver-adapter-implementation`
  - no direct scope change now (documented as non-goal for this UX phase).
- `prisma-postgres`
  - DB provisioning/ops notes where needed.
- `prisma-upgrade-v7`
  - compatibility checkpoint (avoid accidental v7 migration in UX workstream).
- `supabase-postgres-best-practices`
  - indexing/access-pattern guidance for conversation/event queries and onboarding reads.

### 18.11 Detailed Implementation Backlog (Execution Plan)

#### Epic A: Route Architecture and App Shell

- Create route groups:
  - `src/app/(public)/page.tsx`
  - `src/app/(auth)/sign-in/page.tsx`
  - `src/app/(onboarding)/page.tsx`
  - `src/app/(app)/chat/page.tsx`
  - `src/app/(app)/chat/[conversationId]/page.tsx`
  - `src/app/(app)/settings/page.tsx`
- Add shared app shell:
  - left sidebar (conversations/new chat)
  - top bar (mode/model/profile)
  - right activity pane toggle
- Keep existing APIs functional while migrating UI.

#### Epic B: Auth and Onboarding Guards

- Add server-side guard utility:
  - if unauthenticated -> sign-in
  - if authenticated and onboarding incomplete -> onboarding
  - else -> chat workspace
- Add onboarding persistence model:
  - `onboarding_state` table (or equivalent in existing schema)
  - fields: `userId`, `isCompleted`, `currentStep`, `stepDataJson`, `completedAt`, timestamps
- Add onboarding endpoints:
  - `GET /api/onboarding`
  - `POST /api/onboarding` (step save + completion)

#### Epic C: Conversation and Message UX APIs

- Add conversation endpoints:
  - `GET /api/conversations?cursor=&q=`
  - `POST /api/conversations`
  - `PATCH /api/conversations/:id`
  - `DELETE /api/conversations/:id` (soft archive)
- Add message history endpoint:
  - `GET /api/conversations/:id/messages?cursor=`
- Add DB indexes:
  - conversations `(user_id, updated_at desc)`
  - messages `(conversation_id, created_at asc)`

#### Epic D: Onboarding Wizard UI

- Step 1 (required): BYOK provider keys
  - validate at least one active key.
- Step 2: model defaults
  - per-provider preferred model alias.
- Step 3: GitHub connect (optional)
  - show install/callback status.
- Step 4: connectors/MCP bootstrap (optional)
  - quick add and skip path.
- Step 5: review/finish
  - summary and continue to workspace.

#### Epic E: Chat Workspace and Agent Timeline

- Build chat thread UX:
  - streaming assistant bubbles
  - markdown output with safe rendering
  - composer with mode selector (`chat|agent|coding`)
- Build agent timeline cards from run events:
  - status transitions
  - tool call input/output cards
  - approval cards (approve/reject actions inline)
  - coding cards (repo prepare/delegate/diff/PR)
- Realtime merge logic:
  - idempotent event map by `event.id`
  - fallback poll for missed broadcasts.

#### Epic F: Settings/Profile Consolidation

- Move operational forms out of main chat:
  - provider keys
  - model settings
  - GitHub integration
  - connectors
  - MCP servers
  - custom tools
- Add profile menu entry points for each settings tab.

#### Epic G: Remove Legacy Debug Surface

- Remove root `AppConsole` as primary UX.
- Keep optional internal debug route (`/dev/console`) behind non-production guard.

### 18.12 Definition of Done for This UX Re-architecture

- Primary user journey works end-to-end:
  - landing -> Google auth -> onboarding -> chat workspace.
- Chat layout is production-ready:
  - left chat list + main chat + agent timeline.
- Tool-calling transparency is clear:
  - every important run step is visible and understandable.
- Setup/configuration is not mixed into chat:
  - all connector/MCP/BYOK actions are in onboarding or settings.
- Performance and accessibility baseline met:
  - keyboard navigation, focus states, mobile/desktop layout, no major waterfall regressions.
