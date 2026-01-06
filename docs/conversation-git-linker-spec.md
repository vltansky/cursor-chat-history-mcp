# Conversation ↔ Git Linker – Design Spec

## Objectives
1. Automatically connect Cursor conversations to git commits while keeping everything local.
2. Provide a “feels native” experience for AI assistants via the existing `cursor-chat-history-mcp` server.
3. Stay opt-in: users run one bootstrap command, hooks take over, and MCP tools become richer without extra setup per workspace.

## Architecture Overview
```
Cursor Hook (afterFileEdit + stop)
        │ JSON payload (conversation_id, file_path, workspace_root…)
        ▼
cursor-chat-history-mcp CLI (`link capture-hook`)
        │ reads Cursor SQLite via existing reader
        ▼
Link Storage (SQLite @ ~/Library/Application Support/CursorChatHistory/links.sqlite)
        ▲
Git post-commit hook → `cursor-chat-history-mcp link commit`
        │ collects commit hash, branch, changed files
        ▼
Auto linker → matches recent conversations on workspace + files + time, stores link rows
        ▲
MCP tools (`list_conversation_commits`, `get_commit_context`, `get_file_context`)
```

## Components
### 1. Link Storage
- SQLite DB with three tables:
  - `conversations`: metadata captured from hooks (id, workspaceRoot, projectName, title, summary, aiSummary, relevantFiles, attachedFolders, capturedFiles, recordedAt, lastHookEvent).
  - `commits`: commitHash, repoPath, branch, author, message, committedAt, changedFiles.
  - `links`: conversationId ↔ commitHash with matchedFiles, confidence (0-1), status (`auto|manual`), createdAt.
- Stored under `~/Library/Application Support/CursorChatHistory/links.sqlite` (macOS). Linux uses `~/.local/share/...`, Windows uses `%APPDATA%`.

### 2. CLI Subcommands (`cursor-chat-history-mcp link …`)
- `capture-hook --event <hook>`: reads JSON from stdin, saves conversation metadata, normalizes file paths relative to workspace root.
- `commit [--repo <path>] [--hash <sha>]`: records commit metadata, runs auto-link scoring (file overlap + recency), persists `links`.
- `install-cursor-hook`: writes `~/.cursor/hooks/cursor-history-link.sh` and updates `~/.cursor/hooks.json` to trigger on `afterFileEdit` and `stop`.
- `install-git-hook [--repo <path>]`: injects a post-commit snippet that calls the CLI asynchronously.
- `list-conversation-links`, `get-commit-links`: local debugging/inspection commands (JSON output) shared with MCP tools.

### 3. Hooks
- **Cursor**: `afterFileEdit` collects precise file paths per edit, `stop` finalizes the conversation metadata (title, summary, AI summary, referenced files).
- **Git**: post-commit hook runs CLI to record commit details; asynchronous background call to avoid slowing commits.
- Both hooks are optional but installed via the `init` flow for a “one command” experience.

### 4. MCP Tool Extensions
- `list_conversation_commits`: accepts `conversationId`, `projectPath`, `filePath`, `limit`, `outputMode`. Returns conversation metadata + linked commits (hash, branch, summary, matched files, confidence).
- `get_commit_conversations`: given `commitHash`, returns commit metadata + linked conversations.
- `get_file_context`: resolves the most recent conversation + commit touching a path, optionally streams current file contents from disk for instant AI context.
- `link_conversation_commit` (optional): manual linking by conversationId + commitHash for ambiguous cases.

## Matching Heuristics
- Candidate conversations: same workspace root, recorded within 14 days before commit time.
- Score = `0.7 * (matchedFiles / commitFiles)` + `0.3 * recencyFactor`, where `recencyFactor` scales linearly from 1 (same day) to 0 (14 days).
- Store matches only when score ≥ 0.2 to avoid noise; assistants can surface the score so users judge reliability.

## User Flow
1. `npx cursor-chat-history-mcp link install-cursor-hook`
2. `npx cursor-chat-history-mcp link install-git-hook --repo /path/to/project`
3. Keep using Cursor + git:
   - When a chat ends, the hook logs metadata → DB.
   - When a commit happens, the git hook logs commit data + auto-links.
4. AI assistant (via existing MCP server) now answers:
   - “Show commits linked to conversation 123.”
   - “What conversations fed into commit abc123?”
   - “Give me latest chat context for `src/auth/service.ts`.”
5. Manual CLI/tooling available to inspect or override links.

## Open Questions / Future Enhancements
- Should we support other hook events (e.g., `beforeSubmitPrompt`) to capture intent before edits?
- Provide diff snapshots for uncommitted changes? (Would require more disk usage.)
- Multi-repo workspaces: need mapping between workspace root and repo path (initial approach assumes 1:1, but DB schema already stores both for future refinement).
- UI/notifications when linking is uncertain (confidence below threshold) so users can confirm directly in Cursor.
