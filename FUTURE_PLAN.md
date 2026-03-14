# Future Plan — Claude Code on the Web Parity

Gap analysis comparing Relay AI with [Claude Code on the Web](https://code.claude.com/docs/en/claude-code-on-the-web).

---

## Priority 1: Diff View + PR Creation UI

### Diff View
- Full file-by-file diff viewer showing lines added/removed after coding session
- Users can comment on specific changes and iterate with the agent before creating a PR
- Diff stats indicator (e.g. `+12 -1`) appears when Claude makes file changes
- **Implementation**: API to fetch `git diff` from active sandbox, `DiffViewer` component with file list + per-file diff panel

### PR Creation from UI
- "Create PR" button appears after coding session completes
- Modal with title, description, base branch fields
- Users review diff → iterate → create PR — all from UI (not agent-only)
- **Implementation**: `PRCreationModal` component, wired to existing `createPullRequestForBinding()` backend

---

## Priority 2: Terminal / File Progress Panel

### Real-time Coding Progress
- Show Claude working in real-time: file edits, terminal commands, test output
- Terminal panel with scrollable sandbox stdout/stderr output
- File tree showing modified/created files during the session
- **Implementation**: `TerminalViewer` component consuming `coding_agent` timeline events, `FileTreeViewer` for changed files

---

## Priority 3: Branch Selection

- Let users specify which branch to work on (not just auto-generated `chat/{id}`)
- Branch selector dropdown in repo chip or coding session start flow
- Support checking out existing branches (not just default branch)
- **Implementation**: Branch picker UI, pass `branchStrategy` to coding session start, API to list remote branches from sandbox

---

## Priority 4: Environment Configuration

### Setup Scripts
- Bash script that runs when a new sandbox starts, before Claude Code launches
- Used to install dependencies, configure tools, prepare the environment
- Editable in an environment settings UI

### Environment Variables
- Key-value env var editor in the UI
- Passed to the sandbox on creation
- Persisted per-user or per-environment

### Network Access Controls
- Three levels: Limited (allowlisted domains) / Full / No internet
- Currently hardcoded to full internet (`allowInternetAccess: true`)
- Dropdown in environment config

### Named Environments
- Users can create multiple named environments with different configs
- Select default environment per conversation or globally

---

## Priority 5: Quick Wins

### Respect Repo's CLAUDE.md
- Currently we overwrite with our default CLAUDE.md in the sandbox
- Fix: Read the repo's existing CLAUDE.md, append our instructions instead of overwriting
- File: `src/lib/coding/session-service.ts`

### Completion Notifications
- In-app toast/notification when a coding task finishes
- Important for long-running tasks where user switches conversations
- Optional: browser notification API

---

## Priority 6: Session Management

### Session List / History
- Dedicated panel showing all coding sessions across conversations
- Filter by status (active, paused, completed, error)
- Resume paused sessions from the list

### Session Archiving
- Archive completed sessions to keep the list clean
- Archived sessions hidden by default, viewable via filter

### Session Sharing
- Toggle visibility: Private / Team
- Share session link with teammates
- Recipients see latest session state

---

## Already Implemented (Parity)

| Feature | Status |
|---------|--------|
| Repository cloning into sandbox | E2B + GitHub App |
| Coding agent execution (Claude Code CLI) | `--model` flag, `--dangerously-skip-permissions` |
| PR creation (backend) | `coding_session_create_pr` agent tool |
| Real-time event streaming (SSE) | Timeline events |
| Sandbox isolation | E2B VMs |
| Session pause/resume | `coding_session_pause` tool |
| CLAUDE.md in sandbox | Default written on session create |
| Repo linking to conversations | UI modal + conversation FK |
| Tool call visibility | Activity accordion in run thread |

---

## Not Applicable

| Feature | Reason |
|---------|--------|
| Terminal ↔ Web handoff (`--remote`, `--teleport`) | No CLI client |
| Mobile app support | Web-only for now |
| Custom environment images/snapshots | E2B limitation |
| Git credential proxy | E2B handles token injection |
