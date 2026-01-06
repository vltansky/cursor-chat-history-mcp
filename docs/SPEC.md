## Conversation ↔ Git Linker Spec

### Summary
Goal: extend `cursor-chat-history-mcp` to bridge Cursor conversations and git commits via local hooks + CLI, storing link metadata in a shared SQLite DB and exposing it through existing MCP tools.

### Architecture Decisions
1. **Storage**: single SQLite DB at `~/Library/Application Support/CursorChatHistory/links.sqlite` (Linux: `~/.local/share/...`, Windows: `%APPDATA%/...`) containing:
   - `conversations`: `conversationId`, `workspaceRoot`, `projectName`, `title`, `summary`, `aiSummary`, `relevantFiles[]`, `attachedFolders[]`, `capturedFiles[]`, `searchableText`, timestamps, last hook event.
   - `commits`: `commitHash`, `repoPath`, `branch`, `author`, `message`, `committedAt`, `changedFiles[]`.
   - `links`: `conversationId`, `commitHash`, `matchedFiles[]`, `confidence`, `status (auto|manual)`, `createdAt`.
2. **Context Files**: conversation content exported to `~/.cursor-chat-history/context/conversations/` as markdown files for efficient AI navigation using native file tools (Read, Grep).
3. **Single binary**: `cursor-chat-history-mcp` handles both MCP server and linker CLI (`link ...` subcommands) so hooks and users run one executable.
4. **Workspace mapping**: determine repo roots by walking up from file paths when processing hook payloads; cache resolved roots to minimize repeated IO.
5. **Hook installation**: provided command installs global Cursor hook (`~/.cursor/hooks.json` + script) that runs after file edits and `stop`.

### CLI / Hook Workflow
Commands (`cursor-chat-history-mcp link ...`):
- `install-cursor-hook`: copies `cursor-history-link.sh` into `~/.cursor/hooks/`, updates `~/.cursor/hooks.json` to run script for `afterFileEdit` + `stop`. Hook script runs `npx --yes cursor-chat-history-mcp link capture-hook --event <event>`.
- `install-git-hook [--repo]`: injects post-commit snippet calling `npx --yes cursor-chat-history-mcp link commit --repo "$REPO"` asynchronously.
- `capture-hook --event <hookName>`: reads JSON payload from stdin, normalizes file paths relative to detected workspace/repo roots, fetches conversation summary via existing DB reader on `stop`, and upserts into `conversations`.
- `commit [--repo] [--hash] [--branch]`: records commit metadata via git commands, runs auto-link heuristic (window 14 days, score = 0.7 * file overlap + 0.3 * recency, must be ≥0.2), stores matches into `links`.
- `link manual --conversation <id> --commit <hash> [--files] [--confidence]`: creates/updates manual links (status=`manual`).
- `list-conversation-links [--conversation] [--workspace] [--file] [--limit]` and `get-commit-links --hash` for debugging/automation; output human-readable by default with optional JSON flag.

Hook behavior:
- `afterFileEdit`: capture exact file paths edited during session (relative to repo root) into `capturedFiles`.
- `stop`: capture summary/metadata (title, AI summary, relevant files, attached folders, first/last message snippet) from Cursor DB and persist.
All CLI operations respect existing Cursor DB detection logic; environment overrides continue to work.

### MCP Tool Extensions
Add new tools exposed by the MCP server:
1. `list_conversation_commits`: filters by `conversationId`, `projectPath`, `filePath`, `limit`, `outputMode`; returns conversation metadata plus linked commits (hash, branch, message, matched files, confidence, timestamps).
2. `get_commit_conversations`: input `commitHash`; returns commit metadata plus linked conversations.
3. `get_file_context`: input `filePath`, optional `keywords[]`, `limit`; returns linked conversations/commits with keyword matches and excerpts. When `keywords` provided, filters results and returns `keywordMatches` with counts and excerpts for efficient context retrieval without loading full conversations.
4. `get_conversation`: when called, writes conversation content to `~/.cursor-chat-history/context/conversations/<id>.md` and returns file path + stats. AI then uses native Read/Grep tools to navigate large conversations efficiently.
5. `link_conversation_commit` (optional): manual linking via MCP, gated behind user confirmation and writes into same tables.

### Context File Management
- **Location**: `~/.cursor-chat-history/context/conversations/<conversationId>.md`
- **Format**: Markdown with YAML-like header (ID, dates, project, files) followed by timestamped messages with code blocks preserved.
- **Cleanup Strategy**: LRU cache (max 50 files) + TTL (7-day expiry). Cleanup runs on each write operation.
- **AI Workflow**: Tool returns `{ filePath, stats: { messageCount, totalLines, codeBlockCount } }`. AI uses Read with offset/limit or Grep with patterns to navigate without burning context.

### Searchable Text & Keywords
- `searchableText` column stores: title + aiSummary + first message + extracted key phrases.
- `get_file_context` accepts `keywords[]` parameter for filtering.
- Keyword matching uses SQLite LIKE queries against `searchableText`.
- Response includes `keywordMatches[]` with `{ keyword, count, excerpts[] }` for each match.

### UI/UX & Docs
- CLI commands print concise logs; JSON output available via flag.
- README gains "Linking git commits" section covering install steps, auto-link behavior, manual overrides, and new MCP tools; cross-link to `docs/conversation-git-linker-spec.md` for deeper reference.
- Document that `get_file_context` returns metadata + keyword excerpts; assistants use file tools for full conversation content.

### Integration Notes
- Hook scripts use `npx --yes cursor-chat-history-mcp` to avoid requiring global install; mention optional global install for faster startup.
- CLI trusts existing Cursor DB path detection; advanced users can override via env (current behavior remains).
- MCP file access stays metadata-only; no direct disk reads needed for the new tools, keeping security surface small.

### Tool Consolidation (v2)
Reduced from 12 to 8 MCP tools for simplicity:

**Removed:**
- `get_system_info`: AI already has date context
- `export_conversation_data`: Niche use case, available via CLI only
- `extract_conversation_elements`: Overlaps with `get_conversation`

**Merged:**
- `find_related_conversations` → `list_conversations` with `relatedTo` parameter

**Final tools:**
| Tool | Purpose |
|------|---------|
| `list_conversations` | Browse/filter conversations (includes `relatedTo` for similarity) |
| `get_conversation` | Full conversation → file + stats |
| `search_conversations` | Text search in message content |
| `get_conversation_analytics` | Usage patterns and stats |
| `list_conversation_commits` | Commits linked to conversations |
| `get_commit_conversations` | Conversations linked to a commit |
| `get_file_context` | File context with keyword filtering |
| `link_conversation_commit` | Manual linking |

### Outstanding Considerations
- Deferred: ability to capture intent via other hook events (`beforeSubmitPrompt`), diff snapshots, multi-root mapping beyond caching, UX around low-confidence links (maybe user notifications).
- Implementation order: storage + CLI foundation → hooks → auto-link logic → MCP tool additions → docs/tests.

### Implementation Reference
See [conversation-git-linker-implementation.md](conversation-git-linker-implementation.md) for detailed implementation notes including:
- Database schema with column descriptions
- Auto-link algorithm details
- Data flow diagrams
- Hook system internals
- Known limitations and future enhancements
