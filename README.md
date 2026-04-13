# Relay AI

> A web-based AI coding agent platform — bring the power of Claude to your browser with autonomous coding, GitHub integration, and live sandboxed execution.

**Live:** [https://relay-ai-delta.vercel.app/](https://relay-ai-delta.vercel.app/)

---

## Table of Contents

- [Overview](#overview)
- [Who It's For](#who-its-for)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Relay AI is an open-source, claude.ai inspired web-based alternative to terminal-based AI coding agents. It wraps Anthropic's Claude in a full-featured browser UI, giving you:

- A persistent conversation workspace with Chat, Agent, and Coding modes
- Real-time streaming of autonomous agent runs with a live timeline view
- Isolated E2B sandbox environments where Claude can read, write, and execute code against real GitHub repositories
- A complete GitHub integration for cloning repos, committing changes, and opening pull requests

Whether you need a quick AI chat, a deep research session, or a fully autonomous coding task, Relay AI handles it in one place.

---

## Who It's For

Relay AI is built for:

- Developers who want an AI coding agent without leaving the browser
- Teams that want sandboxed execution before touching real repositories
- Builders who need chat, research, code generation, and GitHub workflows in one product
- Anyone exploring a browser-native alternative to terminal-based coding agents.

---

## Features

| Feature | Description |
|---|---|
| **AI Chat** | Multi-turn conversations with Claude across Chat, Agent, and Coding modes |
| **Autonomous Agent Runs** | Claude plans and executes multi-step tasks with a live, streaming timeline |
| **Remote Coding Sessions** | Isolated E2B sandboxes — Claude clones your repo, writes code, and runs it safely |
| **GitHub Integration** | Connect repositories, create branches, commit code, and open pull requests |
| **File Generation & Editing** | Claude creates and modifies files directly inside the sandbox |
| **Web Search & Fetch** | Built-in tools for real-time web search and URL fetching with citations |
| **Image Generation & Editing** | Generate images with Imagen 4 and Gemini models, then iterate with edits in the same conversation |
| **File Attachments** | Upload images, PDFs, and documents into any conversation |
| **MCP Connector Support** | Extend Claude with custom Model Context Protocol servers and tools |
| **Persistent Memory** | Per-user and per-conversation memory that carries across sessions |
| **Real-time Streaming** | Agent events streamed to the client via SSE as they happen |
| **Token Cost Tracking** | Per-run usage and cost recording for billing and observability |
| **Run Approvals** | Optional human-in-the-loop approval gates before agent actions execute |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 16](https://nextjs.org/) — App Router, React Server Components |
| **UI** | [React 19](https://react.dev/), [TailwindCSS 4](https://tailwindcss.com/), [TanStack Query](https://tanstack.com/query), [Zustand](https://zustand-demo.pmnd.rs/) |
| **AI** | [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-python), [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk), [Vercel AI SDK](https://sdk.vercel.ai/) |
| **Auth** | [Supabase](https://supabase.com/) — OAuth + email/password |
| **Database** | PostgreSQL via [Prisma ORM](https://www.prisma.io/) |
| **Caching** | [Upstash Redis](https://upstash.com/) |
| **Background Jobs** | [Inngest](https://www.inngest.com/) |
| **Sandboxes** | [E2B Code Interpreter](https://e2b.dev/) — isolated VM execution |
| **GitHub** | [GitHub App](https://docs.github.com/en/apps) via [Octokit](https://octokit.github.io/rest.js/) |
| **Language** | TypeScript (strict mode) |
| **Package Manager** | pnpm |

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **pnpm** (`npm install -g pnpm`)
- A **PostgreSQL** database (local or hosted, e.g. Supabase, Neon, Railway)
- A **Supabase** project (for authentication)
- An **Anthropic API key**
- An **E2B API key** (required for coding sessions)

### 1. Clone and install dependencies

```bash
git clone https://github.com/Hussain-7/Relay-AI.git
cd Relay-AI
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

**Required variables:**

```env
# App
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://user:password@localhost:5432/relay_ai

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Supabase (Auth)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# E2B (Sandbox execution)
E2B_API_KEY=e2b_...
```

**Optional variables (for full functionality):**

```env
# GitHub App integration (PR creation, repo cloning)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_APP_SLUG=your-app-name
GITHUB_APP_CLIENT_ID=Iv1.abc123
GITHUB_APP_CLIENT_SECRET=abc123
GITHUB_STATE_SECRET=random-secret-string

# Upstash Redis (caching & rate limiting)
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=AX...

# MCP connector token encryption
MCP_TOKEN_SECRET=32-char-random-secret

# Model overrides (these are the defaults)
ANTHROPIC_MAIN_MODEL=claude-sonnet-4-6
ANTHROPIC_TITLE_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_CODING_MODEL=claude-sonnet-4-6
```

### 3. Set up the database

```bash
# Generate the Prisma client
pnpm run prisma:generate

# Push the schema to your database
pnpm run prisma:push
```

### 4. Start the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

To run background job processing alongside the dev server (required for agent runs):

```bash
# In a separate terminal
pnpm run inngest:dev
```

### Available scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start the Next.js development server |
| `pnpm build` | Generate Prisma client and build for production |
| `pnpm start` | Start the production server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | TypeScript type-check without emitting |
| `pnpm run env:check` | Validate all required environment variables |
| `pnpm run prisma:generate` | Regenerate the Prisma client after schema changes |
| `pnpm run prisma:push` | Push schema changes to the database (no migrations) |
| `pnpm run inngest:dev` | Start the Inngest local dev server for background jobs |

---

## Project Structure

```
Relay-AI/
├── prisma/
│   └── schema.prisma          # Database schema (all models)
├── src/
│   ├── app/
│   │   ├── (auth)/            # Login page and auth layout
│   │   ├── api/               # All API route handlers
│   │   │   ├── agent/runs/    # Agent run lifecycle (start, stream, stop, approve)
│   │   │   ├── conversations/ # Conversation & message CRUD
│   │   │   ├── coding/        # Coding session management
│   │   │   ├── github/        # GitHub OAuth & App routes
│   │   │   ├── mcp-connectors/# MCP connector management
│   │   │   └── repo-bindings/ # Repository connection routes
│   │   ├── auth/callback/     # Supabase auth callback handler
│   │   └── chat/              # Chat workspace pages ([id], new, index)
│   ├── components/
│   │   ├── chat/              # All chat UI components
│   │   │   ├── run-thread.tsx         # Agent run timeline view
│   │   │   ├── activity-accordion.tsx # Collapsible activity log
│   │   │   ├── repo-binding-modal.tsx # GitHub repo connector
│   │   │   └── mcp-connector-modal.tsx# MCP server config
│   │   └── chat-workspace.tsx # Root chat layout with sidebar
│   └── lib/
│       ├── main-agent/        # Core agent: runtime, tools, prompts, model
│       │   └── tools/         # Individual agent tools (web, github, memory, etc.)
│       ├── coding/            # E2B sandbox session lifecycle
│       ├── github/            # GitHub App API service
│       ├── memory/            # Persistent user/conversation memory
│       └── ...                # Auth helpers, Redis, Prisma client, utilities
└── .agents/skills/            # Embedded skill references for the agent
```

---

## Contributing

Contributions are welcome. Please follow these steps:

1. **Fork** the repository and clone your fork
2. **Create a branch**: `git checkout -b feature/your-feature-name`
3. **Make focused commits** — one logical change per commit
4. **Check your work**: run `pnpm typecheck && pnpm lint` before pushing
5. **Open a pull request** with a clear description of what changed and why

For significant changes or new features, please open an issue first to discuss the approach before writing code.

---

## License

MIT © Relay AI Contributors
