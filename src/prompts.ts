import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPrompts(server: McpServer) {

  // 1. Extract rules from conversations, git, or PRs
  server.registerPrompt(
    'extract_rules',
    {
      description: 'Extract coding rules and patterns from your conversation history, git changes, or PRs. Default analyzes recent conversations. Provide PR number to analyze specific PR.',
    },
    () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `# Extract Coding Rules

Extract coding patterns and rules from my history.

## Determine Source
Check what context was provided:
- If PR number mentioned → analyze that PR
- If "git diff" or "current changes" mentioned → analyze uncommitted changes
- Otherwise → analyze recent conversations (default)

## Steps by Source

### If Recent Conversations (default)
1. \`list_conversations\` limit=20, last 14 days
2. \`get_conversation_analytics\` with includeBreakdowns=["files", "languages"]
3. Read top conversations with \`get_conversation\` to extract patterns
4. \`list_conversation_commits\` to see what patterns actually shipped

### If Git Diff
1. Run \`git status\` and \`git diff --stat\`
2. Run \`git diff\` for actual changes
3. Analyze patterns: naming, structure, error handling
4. Compare with \`list_conversations\` for related discussions

### If PR (number provided)
1. Run \`gh pr view [number] --json title,body,files,comments,reviews\`
2. Run \`gh pr diff [number]\`
3. Extract patterns from: changes, review comments, description
4. \`get_commit_conversations\` for related discussions

## Output Format
\`\`\`markdown
## Extracted Rules

### [Category]
- **Rule**: [Pattern observed]
- **Example**: [Code snippet or reference]
- **Source**: [Conversation ID / File:line / PR comment]
\`\`\`

Focus on actionable patterns. Skip obvious/generic rules. Only include patterns with 2+ occurrences.`
        }
      }]
    })
  );

  // 2. Continue session with git + recent chats awareness
  server.registerPrompt(
    'continue_session',
    {
      description: 'Resume work with awareness of git status and recent conversations. Shows uncommitted changes, recent commits, and last conversation context.',
    },
    () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `# Continue Session

Resume work with context of current state and recent activity.

## Steps
1. Run \`git status\` - uncommitted changes
2. Run \`git log --oneline -5\` - recent commits
3. Run \`git diff --stat\` - what's modified
4. \`list_conversations\` limit=5 - recent chats
5. \`get_conversation\` for most recent - what was discussed last

## Output Format
\`\`\`markdown
## Session Context

### Current State
[git status summary - staged, modified, untracked]

### Recent Commits
[Last 5 commits with short descriptions]

### Last Conversation
- **Summary**: [What was discussed]
- **Files**: [Files mentioned]
- **Left off**: [Last action/decision/question]

### Suggested Next Steps
[Based on uncommitted changes + last conversation context]
\`\`\`

Be concise. Focus on what's actionable now.`
        }
      }]
    })
  );

  // 3. Find chats - search conversation history
  server.registerPrompt(
    'find_chats',
    {
      description: 'Search conversation history for related discussions. Finds similar problems, solutions, or patterns from past conversations.',
    },
    () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `# Find Chats

Search for conversations related to the user's query.

## Steps
1. Extract keywords from user's query
2. \`search_conversations\` with those keywords
3. If query looks like a file path, also use \`get_file_context\`
4. For top matches, \`get_conversation\` to read details
5. Run \`git log --grep="[keyword]" --oneline -5\` for related commits

## Output Format
\`\`\`markdown
## Found Chats

### 1. [Title/Summary]
- **ID**: [conversation_id]
- **Relevance**: [Why it matches the query]
- **Key Point**: [Main insight, decision, or solution]

### 2. [Title/Summary]
...

### Related Commits
[If any git commits match]

### Summary
[Common themes, applicable insights]
\`\`\`

If no matches found, suggest alternative search terms or approaches.`
        }
      }]
    })
  );

}
