# Cursor Chat History MCP

**Give AI assistants access to your Cursor chat history.**

A Model Context Protocol (MCP) server that allows Cursor, Claude, and other AI assistants to read and analyze your Cursor chat data. This enables personalized coding assistance based on your actual development patterns and history.

<a href="https://glama.ai/mcp/servers/@vltansky/cursor-conversations-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@vltansky/cursor-conversations-mcp/badge" alt="Cursor Conversations Server MCP server" />
</a>

## What This Enables

Ask your AI assistant to:

- Analyze your chat history to understand your coding patterns and usage statistics
- Generate project-specific rules based on your actual development discussions
- Extract insights from past problem-solving sessions and find related conversations
- Create documentation based on real conversations about your code
- Export chat data for external analysis and visualization
- Find and apply solutions you've already worked through

## Key Benefits

**Generate Personalized Rules**: Create coding standards based on your actual development patterns, not generic best practices.

**Learn from Your History**: Extract insights from past chats to improve future development.

**Context-Aware Assistance**: Get help that's informed by your specific projects and coding style.

**Pattern Recognition**: Identify recurring themes and solutions in your development work.

## Quick Start

### 1. Configure MCP
Add to your `.cursor/mcp.json`:

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

### 2. Start Using
```
"Analyze my React conversations and create component guidelines"
"Find debugging patterns in my chat history"
"Generate TypeScript coding standards from my actual usage"
"What are the main themes in my recent coding discussions?"
```

## Available Tools

### Core Tools

- **`list_conversations`** - Browse conversations with filtering options and optional project relevance scoring
- **`get_conversation`** - Retrieve full conversation content with code and file references
- **`search_conversations`** - Enhanced search with multi-keyword, LIKE patterns, and text search

### Analytics & Data Extraction Tools

- **`get_conversation_analytics`** - Comprehensive analytics including usage patterns, file activity, programming language distribution, and temporal trends
- **`find_related_conversations`** - Find conversations related by shared files, folders, languages, size, or temporal proximity
- **`extract_conversation_elements`** - Extract files, code blocks, languages, metadata, and conversation structure with flexible grouping
- **`export_conversation_data`** - Export chat data in JSON, CSV, or Graph formats for external analysis and visualization

## Common Use Cases

### Generate Coding Rules
```
"Create TypeScript interface naming conventions from my conversations"
"Extract error handling patterns and create guidelines"
"Find all my discussions about testing and create best practices"
```

### Extract Best Practices
```
"Show me how I typically use React hooks in my projects"
"Find patterns in my state management discussions"
"Analyze my class inheritance usage and create guidelines"
```

### Advanced Analysis
```
"Find conversations where I discussed specific functions or patterns"
"Search for file-specific discussions across my projects"
"Compare how I've approached similar problems over time"
```

### Create Project Documentation
```
"Generate API documentation from my service discussions"
"Create technical docs from my auth module conversations"
```

### Learn from Past Solutions
```
"Find similar debugging sessions and extract solutions"
"Analyze my performance optimization discussions"
```

### Data Analysis & Insights
```
"Get comprehensive analytics on my coding patterns over the last 3 months"
"Export all conversations with React code to CSV for analysis"
"Find conversations similar to this database migration discussion"
```

## Privacy & Security

- **Runs locally** - Your chat data never leaves your machine
- **No external services** - Direct access to your local Cursor database
- **No API keys required** - No data sharing with external services
- **Full control** - You decide what data to access and when

## How It Works

**Summary-First Approach for Efficiency**

The entire system is designed to be both powerful and context-efficient:

### **Data Access Process**
1. **Full Content Analysis**: All tools access complete chat data including:
   - Complete message text and code blocks
   - File references and folder paths
   - Conversation metadata and titles
   - AI-generated summaries

2. **Smart Result Delivery**: Different tools provide focused outputs:
   - **`list_conversations`**: Returns conversation summaries with titles and metadata
   - **`search_conversations`**: Searches full content but returns only summaries with relevance scores
   - **Analytics tools**: Extract insights and patterns without overwhelming detail

3. **Summary-First Results**: Most tools return:
   - Conversation summaries and titles
   - Key metadata (files, folders, message count)
   - AI-generated summaries when available
   - Relevant scores and analytics

### **Why This Design?**
- **Context Efficiency**: Avoids overwhelming AI assistants with full message content
- **Performance**: Summaries are much smaller and faster to process
- **Discoverability**: Users can quickly scan results to identify relevant conversations
- **Deep Dive When Needed**: Use `get_conversation` for full content of specific conversations

This approach lets you efficiently browse, search, and analyze your chat history, then dive deep only into conversations that matter for your current task.

## Installation

### For Development
```bash
git clone https://github.com/vltansky/cursor-chat-history-mcp
cd cursor-chat-history-mcp
yarn install
yarn build
```

### For Use
The npx configuration above handles installation automatically.

## Tool Reference

### Output Formats

All tools support JSON output formats via the `outputMode` parameter:

- **`json` (default)** - Formatted JSON with proper indentation for readability
- **`compact-json`** - Minified JSON without formatting for minimal size

### Core Tools

**`list_conversations`**
- `limit` (default: 10) - Number of conversations to return
- `includeAiSummaries` (default: true) - Include AI-generated summaries for efficient browsing
- `projectPath` - Filter by project path
- `includeRelevanceScore` (default: false) - Include relevance scores when filtering by projectPath
- `hasCodeBlocks` - Filter conversations with/without code
- `keywords` - Search by keywords
- `filePattern` - Filter by file pattern

**`get_conversation`**
- `conversationId` (required) - Conversation to retrieve
- `summaryOnly` (default: false) - Get enhanced summary without full content to save context
- `includeMetadata` (default: false) - Include additional metadata

**`search_conversations`** - Enhanced search with multiple methods
- **Simple Query**: `query` - Basic text search (backward compatible)
- **Multi-keyword**: `keywords` array with `keywordOperator` ('AND'/'OR')
- **LIKE Patterns**: `likePattern` - SQL LIKE patterns (% = any chars, _ = single char)
- `searchType` (default: 'all') - 'all', 'project', 'files', 'code'
- `maxResults` (default: 10) - Maximum results
- `includeCode` (default: true) - Include code blocks

### Analytics & Data Extraction Tools

**`get_conversation_analytics`**
- `scope` (default: 'all') - 'all', 'recent', 'project'
- `projectPath` - Focus on specific project (required when scope='project')
- `recentDays` (default: 30) - Time window for recent scope
- `includeBreakdowns` (default: ['files', 'languages']) - Analysis types: 'files', 'languages', 'temporal', 'size'

**`find_related_conversations`**
- `referenceConversationId` (required) - Starting conversation
- `relationshipTypes` (default: ['files']) - 'files', 'folders', 'languages', 'size', 'temporal'
- `maxResults` (default: 10) - Number of results
- `minScore` (default: 0.1) - Minimum similarity score (0-1)
- `includeScoreBreakdown` (default: false) - Show individual relationship scores

**`extract_conversation_elements`**
- `conversationIds` - Specific conversations (optional, processes all if empty)
- `elements` (default: ['files', 'codeblocks']) - 'files', 'folders', 'languages', 'codeblocks', 'metadata', 'structure'
- `includeContext` (default: false) - Include surrounding message text
- `groupBy` (default: 'conversation') - 'conversation', 'element', 'none'
- `filters` - Filter by code length, file extensions, or languages

**`export_conversation_data`**
- `conversationIds` - Specific conversations (optional, exports all if empty)
- `format` (default: 'json') - 'json', 'csv', 'graph'
- `includeContent` (default: false) - Include full message text
- `includeRelationships` (default: false) - Calculate file/folder connections
- `flattenStructure` (default: false) - Flatten for CSV compatibility
- `filters` - Filter by size, code blocks, or project path

## Database Paths

Auto-detected locations:
- **macOS**: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- **Windows**: `%APPDATA%/Cursor/User/globalStorage/state.vscdb`
- **Linux**: `~/.config/Cursor/User/globalStorage/state.vscdb`

## Technical Notes

- Supports both legacy and modern Cursor conversation formats
- Uses SQLite to access Cursor's chat database
- Close Cursor before running to avoid database lock issues
- Conversations filtered by size (>1000 bytes) to exclude empty ones
- Uses ROWID for chronological ordering (UUIDs are not chronological)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT