# Endless Dev: Agent Harness Plan (Next.js + AI SDK + BYOK + MCP + Remote Coding)
Last updated: 2026-03-03

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
- packages/agent-core
  - provider adapters, model router, tool registry, MCP gateway, policy engine, run state machine
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
- One shared run state machine (in `agent-core`) used by:
  - Vercel agent mode
  - E2B coding mode (runner)
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
- The runner imports shared logic from `packages/agent-core` (same tool registry, policy engine, model router, MCP gateway).
- Model calls inside E2B still use AI SDK with user-selected/quality-routed OpenAI or Anthropic models.

### 17.2 Sandbox bootstrap and credentials
- `POST /api/coding/sessions` creates `coding_session` + `agent_run`, then starts an E2B sandbox.
- The API injects short-lived secrets into sandbox env only for that run:
  - GitHub installation token
  - provider API key (decrypted server-side just in time)
  - short-lived backend event-ingest token (runner posts events to API, API persists via Prisma and publishes Realtime)
- Runner command starts with `runId`, `sessionId`, `repo`, `baseBranch`, `workingBranch`.

### 17.3 Repo checkout and workspace prep
- Runner clones target repo into sandbox workspace and checks out `baseBranch`.
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
