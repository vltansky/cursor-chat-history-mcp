# Conversation ↔ Git Linker Research

## Problem & Goals
- Agents lose context between Cursor chats and the commits that implement them.
- Users want a local-only link between conversations, files, and git history so AI tools can answer “which commit came from this chat?” or “what chats led to this commit?”.
- The solution must feel native to Cursor/Codex agents, avoid duplicating full chat text, and keep all data on-device.

## Cursor Data Access
- Cursor chat content already lives in the SQLite DB at `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (`README.md:32-69`, `docs/research.md`).
- `cursor-chat-history-mcp` uses `CursorDatabaseReader` to fetch summaries that include:
  - `relevantFiles`, `attachedFolders`, code block counts, first/last messages (`src/database/reader.ts:566-642`).
  - Modern conversations also expose AI summaries (`latestConversationSummary`) and titles.
- Filtering by `projectPath`, `filePattern`, or `relevantFiles` is already supported in `list_conversations` (`src/tools/conversation-tools.ts`), so we can reuse those concepts when asking for linked chats.

## Cursor Hooks Findings
- Hooks are configured via `~/.cursor/hooks.json` (or project/global overrides) and execute scripts for events like `afterFileEdit` or `stop`.
- Hook payloads always include `conversation_id`, `hook_event_name`, `workspace_roots`, and user metadata (see `thedotmack/claude-mem` → `docs/context/cursor-hooks-reference.md`).
- `afterFileEdit` payload provides `file_path` and edit details; `stop` includes `status` and conversation metadata.
- Scripts communicate over stdin/stdout JSON; returning data is optional for auditing hooks.
- Installing hooks is just copying scripts into `~/.cursor/hooks/` and referencing them in `hooks.json` (e.g., `hamzafer/cursor-hooks`).

## Git Hook + CLI Opportunities
- Git post-commit hooks can run arbitrary scripts without network access, perfect for recording commit metadata right after commits.
- Combining Cursor hooks (capture chat metadata) and git hooks (capture commit metadata) gives a tight feedback loop without modifying Cursor itself.
- CLI entry point can orchestrate capture, linking, and manual management commands (similar to how this package already ships a `bin` entry).

## Constraints & Considerations
- **Privacy:** Never copy full chat text; store IDs + summaries so MCP tools can pull actual content only when needed.
- **Multiple sessions per commit:** schema must support N:M links with timestamps and confidence.
- **Branches:** include branch name + commit metadata to help assistants warn about unmerged work.
- **Resilience:** Hooks should be idempotent (re-running stop hook shouldn’t duplicate records) and CLI should degrade gracefully when repos aren’t git-initialized.
- **Assistant Experience:** Expose read-only MCP tools (`list_conversation_commits`, `get_commit_context`, `get_file_context`) so AI assistants can query the link data seamlessly.
- **Extensibility:** Keeping capture logic (hooks + CLI) separate from MCP queries allows optional adoption; assistants see “no linked data yet” rather than errors.
