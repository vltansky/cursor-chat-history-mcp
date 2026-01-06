# Cursor Chat History MCP

**Connect your Cursor conversations to your git history.**

<a href="https://glama.ai/mcp/servers/@vltansky/cursor-conversations-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@vltansky/cursor-conversations-mcp/badge" alt="Cursor Conversations Server MCP server" />
</a>

## Why?

You make a commit. Weeks later you wonder: *"Why did I write it this way?"*

The git message says `fix auth bug` but the real context - the debugging session, the alternatives considered, the AI suggestions - lives in a Cursor conversation you'll never find again.

This MCP server automatically links your Cursor conversations to git commits. When you revisit code, the AI assistant can pull up the original discussion.

## Quick Start

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cursor-chat-history": {
      "command": "npx",
      "args": ["-y", "--package=cursor-chat-history-mcp", "cursor-chat-history-mcp"]
    }
  }
}
```

That's it. Hooks install automatically on first use.

## What You Can Do

### Find Context for Code
```
"What was the context behind commit abc123?"
"Find the conversation that led to this fix"
"Show discussions about auth.ts from the last month"
```

### Search Your Chat History
```
"Find all debugging sessions about performance"
"Search conversations mentioning useState"
"List recent conversations in this project"
```

### Extract Patterns
```
"Create TypeScript guidelines from my actual usage"
"Extract error handling patterns from my conversations"
"Summarize my React patterns from chat history"
```

## Available Tools

### Git Linker
| Tool | Purpose |
|------|---------|
| `get_file_context` | Get conversations and commits related to a file |
| `get_commit_conversations` | Find conversations linked to a commit |
| `list_conversation_commits` | Find commits linked to a conversation |
| `link_conversation_commit` | Manually link conversation ↔ commit |

### Chat History
| Tool | Purpose |
|------|---------|
| `list_conversations` | Browse with filters (project, keywords, files) |
| `get_conversation` | Get full conversation content |
| `search_conversations` | Multi-keyword and pattern search |
| `get_conversation_analytics` | Usage patterns, file activity, language stats |

## Privacy

- **100% local** - No external services, no API keys
- **Your data stays on disk** - SQLite databases only
- **Open source** - Audit the code yourself

---

## How It Works

Hooks are installed automatically when the MCP server starts:
- **Cursor hooks** (`~/.cursor/hooks.json`) - capture file edits and session ends
- **Git post-commit hook** (current repo) - link commits to conversations

When you commit, the system finds related conversations using:
- **File overlap (70%)**: Commits touching files discussed in conversations
- **Recency (30%)**: Conversations from the last 14 days

### Efficient Context Retrieval

Large conversations aren't loaded directly into context. Instead:
1. Use `get_file_context` with `keywords` to find relevant conversations
2. Call `get_conversation` - writes to `~/.cursor-chat-history/context/conversations/<id>.md`
3. Use Read/Grep tools to navigate the markdown file efficiently

### CLI Commands

```bash
# Query links
npx cursor-chat-history-mcp link list-conversation-links --conversation <id>
npx cursor-chat-history-mcp link get-commit-links --hash <commit-hash>

# Manual linking
npx cursor-chat-history-mcp link manual --conversation <id> --commit <hash>
```

## Database Locations

| Database | macOS | Windows | Linux |
|----------|-------|---------|-------|
| Cursor chats | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | `%APPDATA%/Cursor/...` | `~/.config/Cursor/...` |
| Git links | `~/Library/Application Support/CursorChatHistory/links.sqlite` | `%APPDATA%/CursorChatHistory/...` | `~/.local/share/CursorChatHistory/...` |
| Context files | `~/.cursor-chat-history/context/conversations/` | same | same |

Override with `CURSOR_DB_PATH` or `CURSOR_LINKS_DB_PATH`.

## Tool Reference

<details>
<summary>Core Tools Parameters</summary>

**`list_conversations`**
- `limit` (default: 10) - Number of results
- `projectPath` - Filter by project
- `keywords` - Search keywords
- `hasCodeBlocks` - Filter by code presence

**`get_conversation`**
- `conversationId` (required) - Conversation ID
- `summaryOnly` - Return summary only (saves context)

**`search_conversations`**
- `query` - Text search
- `keywords` + `keywordOperator` ('AND'/'OR') - Multi-keyword
- `likePattern` - SQL LIKE patterns

**`get_conversation_analytics`**
- `scope` - 'all', 'recent', 'project'
- `projectPath` - Filter by project
- `includeBreakdowns` - ['files', 'languages', 'temporal', 'size']

</details>

<details>
<summary>Git Linker Tools Parameters</summary>

**`get_file_context`**
- `filePath` (required) - File to get context for
- `keywords` - Filter by keywords (e.g., `["JWT", "auth"]`) - returns matching excerpts
- `limit` - Max results (default: 5)

**`list_conversation_commits`**
- `conversationId` - Filter by conversation
- `projectPath` - Filter by project
- `filePath` - Filter by file

**`get_commit_conversations`**
- `commitHash` (required) - Git commit hash

**`link_conversation_commit`**
- `conversationId` (required)
- `commitHash` (required)
- `confidence` - Link confidence (0-1)

</details>

## Development

```bash
git clone https://github.com/vltansky/cursor-chat-history-mcp
cd cursor-chat-history-mcp
yarn install
yarn build
```

## Technical Notes

- Supports legacy and modern Cursor conversation formats
- Uses ROWID for chronological ordering (UUIDs aren't chronological)
- Close Cursor to avoid database lock issues
- See [docs/SPEC.md](docs/SPEC.md) for git linker specification

## License

MIT
