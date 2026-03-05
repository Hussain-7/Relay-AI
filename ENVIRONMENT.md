# Environment Setup

This project supports multiple services. Configure `.env.local` from `.env.example`.

## Quick Start

```bash
cp .env.example .env.local
pnpm env:check
```

## Required For Core App

- `APP_URL`
  - Local default: `http://localhost:3000`
- `DATABASE_URL`
  - Supabase Postgres connection string
- `DIRECT_URL`
  - Direct Postgres URL for Prisma migrations
- `NEXT_PUBLIC_SUPABASE_URL`
  - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Supabase anon public key
- `ENCRYPTION_KEY`
  - 32-byte base64 key for encrypted secrets at rest
  - Example: `openssl rand -base64 32`

## Required For Full Agent Platform

- `E2B_API_KEY`
  - E2B account API key for sandbox sessions
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_SLUG`
- `GITHUB_STATE_SECRET`
  - GitHub App OAuth/install callback integrity
- `RUNNER_EVENT_TOKEN`
  - Internal token used by the coding runner to publish run events
- `INNGEST_EVENT_KEY`
  - Inngest event publish key
- `INNGEST_SIGNING_KEY`
  - Inngest webhook signature verification key

## Optional / Feature Flags

- `SUPABASE_SERVICE_ROLE_KEY`
  - Enables server-side realtime broadcast publishing and privileged server actions
- `E2B_TEMPLATE`
  - Preferred E2B custom template alias/id for preconfigured coding containers
- `E2B_TEMPLATE_ID`
  - Alternate template env if you prefer explicit id naming
- `ALLOW_INSECURE_USER_HEADER`
  - Dev-only fallback auth using `x-user-id`; keep `false` in production

## Notes

- `GITHUB_TOKEN` is injected into sandboxes at runtime when a GitHub App installation token is minted.
- `NODE_ENV` is managed by runtime/build tooling.
