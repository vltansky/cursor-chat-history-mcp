# Conversation ↔ Git Linker - Implementation Notes

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Cursor IDE                                   │
│  ┌─────────────────┐    ┌─────────────────┐                         │
│  │ File Edit Hook  │    │  Session Stop   │                         │
│  │ (afterFileEdit) │    │   Hook (stop)   │                         │
│  └────────┬────────┘    └────────┬────────┘                         │
└───────────┼──────────────────────┼──────────────────────────────────┘
            │                      │
            ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                cursor-chat-history-mcp link capture-hook             │
│  • Reads JSON payload from stdin                                     │
│  • Normalizes file paths relative to workspace                       │
│  • Upserts into links.sqlite conversations table                     │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        links.sqlite                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │conversations│  │   commits   │  │    links    │                  │
│  │             │  │             │  │             │                  │
│  │ capturedFiles│◄─┤changedFiles │──┤matchedFiles │                  │
│  │ relevantFiles│  │             │  │ confidence  │                  │
│  └─────────────┘  └─────────────┘  └─────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
            ▲                      ▲
            │                      │
┌───────────┴──────────────────────┴──────────────────────────────────┐
│                    Git Post-Commit Hook                              │
│  • Runs asynchronously (& background)                                │
│  • Calls: cursor-chat-history-mcp link commit                        │
│  • Records commit metadata + auto-links                              │
└─────────────────────────────────────────────────────────────────────┘
```

## Database Schema

### conversations table
| Column | Type | Description |
|--------|------|-------------|
| conversationId | TEXT PK | Cursor conversation UUID |
| workspaceRoot | TEXT | Absolute path to workspace |
| projectName | TEXT | Extracted from workspace path |
| title | TEXT | From Cursor `name` field (modern format) |
| summary | TEXT | Manual summary (unused currently) |
| aiSummary | TEXT | From `latestConversationSummary.summary.summary` |
| relevantFiles | TEXT (JSON) | Files from conversation context |
| attachedFolders | TEXT (JSON) | Folders attached to conversation |
| capturedFiles | TEXT (JSON) | Files captured by afterFileEdit hook |
| searchableText | TEXT | Concatenated: title + aiSummary + first message (for keyword search) |
| createdAt | TEXT | ISO timestamp |
| updatedAt | TEXT | ISO timestamp |
| lastHookEvent | TEXT | 'afterFileEdit' or 'stop' |

### commits table
| Column | Type | Description |
|--------|------|-------------|
| commitHash | TEXT PK | Full SHA-1 hash |
| repoPath | TEXT | Absolute path to repository |
| branch | TEXT | Branch name at commit time |
| author | TEXT | Author name <email> |
| message | TEXT | Commit subject line |
| committedAt | TEXT | ISO timestamp from git |
| changedFiles | TEXT (JSON) | Files changed in commit |
| createdAt | TEXT | When recorded in our DB |

### links table
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| conversationId | TEXT FK | References conversations |
| commitHash | TEXT FK | References commits |
| matchedFiles | TEXT (JSON) | Files that matched |
| confidence | REAL | Score 0.0-1.0 |
| status | TEXT | 'auto' or 'manual' |
| createdAt | TEXT | ISO timestamp |
| UNIQUE | | (conversationId, commitHash) |

## Auto-Link Algorithm

```
score = 0.7 × file_overlap + 0.3 × recency

where:
  file_overlap = |commit_files ∩ conversation_files| / |commit_files|
  recency = 1 - (days_since_conversation / 14)

Thresholds:
  - Window: 14 days before commit
  - Minimum score: 0.2
```

### File Matching
- Paths normalized: backslashes → forward slashes, lowercase
- Leading slashes removed
- Comparison is exact match after normalization

## Cursor Hook System

### Hook Installation Location
```
~/.cursor/hooks.json
~/.cursor/hooks/cursor-history-link.sh
```

### hooks.json Structure
```json
{
  "hooks": {
    "afterFileEdit": [
      "/path/to/script afterFileEdit"
    ],
    "stop": [
      "/path/to/script stop"
    ]
  }
}
```

### Hook Events (Known)
| Event | Trigger | Payload |
|-------|---------|---------|
| `afterFileEdit` | File saved in editor | files[], workspaceRoot, conversationId |
| `stop` | Session/conversation ends | conversationId, workspaceRoot |
| `beforeSubmitPrompt` | Before sending to AI | (deferred - not implemented) |

**Note**: Hook payload structure is based on reverse engineering. Actual payloads may vary and should be tested.

## Git Hook Integration

### Post-Commit Hook Location
```
<repo>/.git/hooks/post-commit
```

### Hook Content (Appended)
```bash
# cursor-chat-history-linker
(npx --yes cursor-chat-history-mcp link commit --repo "$PWD" &) 2>/dev/null
# cursor-chat-history-linker-end
```

### Key Design Decisions
1. **Async execution**: `&` runs in background to avoid slowing commits
2. **npx --yes**: Auto-install without prompts
3. **Marker comments**: Allow detection of existing installation

## Data Flow

### afterFileEdit Event
```
1. Hook script receives event from Cursor
2. Runs: npx cursor-chat-history-mcp link capture-hook --event afterFileEdit
3. Reads JSON payload from stdin
4. Extracts: conversationId, files[], workspaceRoot
5. Finds repo root by walking up from file paths
6. Normalizes paths relative to repo root
7. Upserts conversation with capturedFiles (merged with existing)
```

### stop Event
```
1. Hook script receives event from Cursor
2. Runs: npx cursor-chat-history-mcp link capture-hook --event stop
3. Reads JSON payload from stdin
4. Connects to Cursor's state.vscdb
5. Fetches: title, aiSummary, relevantFiles, attachedFolders
6. Upserts conversation with full metadata
```

### Post-Commit
```
1. Git triggers post-commit hook
2. Runs async: cursor-chat-history-mcp link commit
3. Extracts: hash, branch, author, message, changedFiles via git CLI
4. Upserts commit record
5. Finds conversations updated within 14-day window
6. Calculates file overlap + recency score
7. Creates links for candidates with score ≥ 0.2
```

## MCP Tool Integration

### list_conversation_commits
- Filters: conversationId, projectPath, filePath
- Returns: conversation + linked commits with confidence

### get_commit_conversations
- Input: commitHash
- Returns: commit + linked conversations with confidence

### get_file_context
- Input: filePath
- Returns: conversations and commits touching file
- Relevance: 'direct' (exact match) or 'indirect' (partial path match)
- Guidance text: instructs AI to use file-reading tools for content

### link_conversation_commit
- Creates manual link
- Can link even if only one side exists in DB

## Known Limitations

1. **Hook payload format**: Based on assumptions; needs testing with real Cursor hooks
2. **Cursor hook support**: Cursor's hook system is not officially documented
3. **No timestamp in modern conversations**: Can't filter by message time easily
4. **Cross-repo conversations**: Only first detected repo is used as workspaceRoot
5. **Native module dependency**: better-sqlite3 requires compilation

## Future Enhancements (from spec)

- [ ] `beforeSubmitPrompt` hook for capturing intent
- [ ] Diff snapshots at hook events
- [ ] Multi-root workspace mapping
- [ ] Low-confidence link notifications
- [ ] User confirmation UI for auto-links

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CURSOR_LINKS_DB_PATH` | Override links database path |
| `CURSOR_DB_PATH` | Override Cursor database path |

## File Locations

| Purpose | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Links DB | `~/Library/Application Support/CursorChatHistory/links.sqlite` | `%APPDATA%/CursorChatHistory/links.sqlite` | `~/.local/share/CursorChatHistory/links.sqlite` |
| Context Files | `~/.cursor-chat-history/context/conversations/` | `~/.cursor-chat-history/context/conversations/` | `~/.cursor-chat-history/context/conversations/` |
| Cursor DB | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | `%APPDATA%/Cursor/User/globalStorage/state.vscdb` | `~/.config/Cursor/User/globalStorage/state.vscdb` |
| Cursor Hooks | `~/.cursor/hooks.json` | `~/.cursor/hooks.json` | `~/.cursor/hooks.json` |

## Context File System

### Purpose
Large conversations can consume excessive context when loaded directly. Instead, conversation content is written to markdown files that AI can navigate using native file tools (Read, Grep).

### File Format
```markdown
# Conversation: <title>

| Field | Value |
|-------|-------|
| ID | <conversationId> |
| Created | <ISO timestamp> |
| Updated | <ISO timestamp> |
| Project | <projectName> |
| Files | <relevantFiles comma-separated> |

---

## Message 1 (User) — <timestamp>

<message content>

---

## Message 2 (Assistant) — <timestamp>

<message content with code blocks preserved>

```typescript
// Code blocks maintain syntax highlighting
```

---
```

### Cleanup Strategy
- **LRU Cache**: Maximum 50 conversation files retained
- **TTL**: Files older than 7 days are deleted
- **Trigger**: Cleanup runs on each new file write
- **Implementation**: Check file count and mtime, delete oldest files exceeding limits

### AI Workflow
```
1. AI calls get_conversation({ conversationId: "abc123" })
2. Tool writes content to ~/.cursor-chat-history/context/conversations/abc123.md
3. Tool returns:
   {
     filePath: "/Users/.../.cursor-chat-history/context/conversations/abc123.md",
     stats: {
       messageCount: 150,
       totalLines: 2400,
       fileSize: "125KB",
       codeBlockCount: 23
     },
     guidance: "Use Read/Grep tools to navigate this file"
   }
4. AI uses Grep({ pattern: "JWT|auth", path: filePath }) to find relevant sections
5. AI uses Read({ file_path: filePath, offset: 100, limit: 50 }) for specific sections
```

## Keyword Search

### searchableText Column
Populated during `stop` hook with concatenation of:
- `title` (conversation name)
- `aiSummary` (AI-generated summary)
- First user message (captures initial intent)

### get_file_context with Keywords
```typescript
// Request
get_file_context({
  filePath: "src/auth.ts",
  keywords: ["JWT", "token", "refresh"],
  limit: 5
})

// Response
{
  filePath: "src/auth.ts",
  conversations: [
    {
      conversationId: "conv-123",
      title: "Add JWT authentication",
      aiSummary: "Implemented token-based auth...",
      confidence: 0.92,
      keywordMatches: [
        { keyword: "JWT", count: 5, excerpts: ["...implement JWT...", "...JWT expiry..."] },
        { keyword: "token", count: 3, excerpts: ["...refresh token..."] }
      ]
    }
  ],
  commits: [...],
  hints: ["High confidence match. Use get_conversation for full context."]
}

## Testing Notes

- Unit tests require `better-sqlite3` native module
- Node 22.18+ may have compilation issues with better-sqlite3@9.2.2
- Use Node 20.x or upgrade better-sqlite3 for testing
- Tests use temp files in `/tmp` - cleaned up in afterEach
