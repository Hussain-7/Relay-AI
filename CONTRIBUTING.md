# Contributing to Relay AI

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

1. **Fork** the repository and clone your fork
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env.local` and configure required variables
4. Set up the database: `pnpm prisma:generate && pnpm prisma:push`
5. Start the dev server: `pnpm dev`

## Development Workflow

1. Create a branch from `main`: `git checkout -b feature/your-feature`
2. Make your changes with focused, logical commits
3. Run checks before pushing:
   ```bash
   pnpm typecheck
   pnpm lint
   ```
4. Open a pull request with a clear description of what changed and why

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a brief description of what the change does and why
- Add screenshots for UI changes
- Ensure `pnpm typecheck` and `pnpm lint` pass

## Reporting Bugs

Open a [GitHub Issue](https://github.com/Hussain-7/Relay-AI/issues/new?template=bug_report.md) with:
- Steps to reproduce
- Expected vs actual behavior
- Browser/OS info if relevant
- Console errors or screenshots

## Feature Requests

For significant changes or new features, please [open an issue](https://github.com/Hussain-7/Relay-AI/issues/new?template=feature_request.md) first to discuss the approach before writing code.

## Code Style

- TypeScript with strict mode
- ESLint with `next/core-web-vitals` + TypeScript rules
- Tailwind CSS v4 for styling
- Zod for all request/response validation
- Prefer editing existing files over creating new ones

## Project Architecture

See [CLAUDE.md](./CLAUDE.md) for a detailed overview of the architecture, data flow, and source layout.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
