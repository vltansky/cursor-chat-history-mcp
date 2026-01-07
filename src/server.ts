#!/usr/bin/env node

/*
 * WORKFLOW GUIDANCE FOR AI ASSISTANTS:
 *
 * **ALWAYS START WITH PROJECT FILTERING** for project-specific analysis:
 * 1. DISCOVERY: Use list_conversations with projectPath parameter to find project-specific conversations
 * 2. ANALYTICS: Use get_conversation_analytics with projectPath and ["files", "languages"] breakdowns
 *    - Files/languages breakdowns contain conversation IDs in their arrays!
 * 3. DEEP DIVE: Use get_conversation with specific conversation IDs from step 1 or 2
 *    - Returns file path to markdown file - use Read/Grep tools to navigate large conversations
 *
 * RECOMMENDED PATTERN FOR PROJECT ANALYSIS:
 * - list_conversations(projectPath: "project-name", startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD")
 * - get_conversation_analytics(projectPath: "project-name", includeBreakdowns: ["files", "languages"])
 * - Extract conversation IDs from files/languages.conversations arrays
 * - get_conversation(conversationId: "id-from-breakdown") returns file path
 * - Use Read/Grep tools on the returned file path to find specific content
 *
 * PROJECT PATH EXAMPLES:
 * - "my-app" (project name)
 * - "/Users/name/Projects/my-app" (full path)
 * - "editor-elements" (project name from path like /Users/name/Projects/editor-elements)
 *
 * GIT LINKER TOOLS:
 * - list_conversation_commits: Find git commits linked to conversations
 * - get_commit_conversations: Find conversations linked to a specific commit
 * - get_file_context: Get conversation/commit context for a file (supports keywords filtering)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  listConversations,
  getConversation,
  searchConversations,
  getConversationsByProject
} from './tools/conversation-tools.js';
import { getConversationAnalytics } from './tools/analytics-tools.js';
import {
  listConversationCommits,
  getCommitConversations,
  getFileContext,
  linkConversationCommit,
  listConversationCommitsSchema,
  getCommitConversationsSchema,
  getFileContextSchema,
  linkConversationCommitSchema,
  runLinkerCli,
} from './linker/index.js';
import { z } from 'zod';
import { formatResponse } from './utils/formatter.js';
import { autoInstallHooks } from './linker/auto-install.js';
import { registerPrompts } from './prompts.js';
import { parseTimeRange, isTimeExpression } from './utils/time-parser.js';

// Handle CLI commands if 'link' subcommand is used
const args = process.argv.slice(2);
if (args[0] === 'link') {
  runLinkerCli(args.slice(1)).then(() => {
    process.exit(process.exitCode ?? 0);
  });
} else {
  // Continue with MCP server startup

  // Auto-install Cursor and Git hooks silently on startup
  autoInstallHooks();

const server = new McpServer({
  name: 'cursor-chat-history-mcp',
  version: '0.1.0',
});

server.tool(
  'list_conversations',
  'Lists Cursor chats with summaries, titles, and metadata ordered by recency. **HIGHLY RECOMMENDED: Use projectPath parameter to filter conversations by specific project/codebase** - this dramatically improves relevance by finding conversations that actually worked on files in that project. Returns conversation IDs for use with get_conversation tool. WORKFLOW TIP: Start with projectPath filtering for project-specific analysis, then call get_conversation with specific IDs from results. Includes AI-generated summaries by default. Supports natural time filtering ("last week", "yesterday", "past 3 days") or date range (YYYY-MM-DD format).',
  {
    limit: z.number().min(1).max(100).optional().default(10).describe('Maximum number of conversations to return (1-100)'),
    minLength: z.number().min(0).optional().default(100).describe('Minimum conversation length in characters to include'),
    minQualityScore: z.number().min(0).max(100).optional().describe('Minimum quality score (0-100). Higher scores = conversations with code blocks, solutions, file refs, git links.'),
    hasCodeBlocks: z.boolean().optional().describe('Filter to conversations that contain code blocks'),
    keywords: z.array(z.string()).optional().describe('Filter conversations containing any of these exact keywords (literal text matching)'),
    projectPath: z.string().optional().describe('**RECOMMENDED** Filter conversations by project/codebase name (e.g., "my-app") or full path (e.g., "/Users/name/Projects/my-app"). This finds conversations that actually worked on files in that project, dramatically improving relevance for project-specific analysis.'),
    filePattern: z.string().optional().describe('Filter conversations mentioning files matching this pattern (e.g., "*.tsx")'),
    relevantFiles: z.array(z.string()).optional().describe('Filter conversations that reference any of these specific files'),
    timeRange: z.string().optional().describe('Natural language time filter: "yesterday", "last week", "past 3 days", "this month", "last 2 weeks"'),
    startDate: z.string().optional().describe('Start date for filtering (YYYY-MM-DD). Overridden by timeRange if both provided.'),
    endDate: z.string().optional().describe('End date for filtering (YYYY-MM-DD). Overridden by timeRange if both provided.'),
    includeEmpty: z.boolean().optional().default(false).describe('Include conversations with no messages'),
    includeAiSummaries: z.boolean().optional().default(true).describe('Include AI-generated conversation summaries'),
    includeQualityScore: z.boolean().optional().default(false).describe('Include quality scores in response'),
    includeRelevanceScore: z.boolean().optional().default(false).describe('Include relevance scores when filtering by projectPath'),
    outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format: "json" for formatted JSON (default), "compact-json" for minified JSON')
  },
  async (input) => {
    try {
      // Parse natural language time range if provided
      let startDate = input.startDate;
      let endDate = input.endDate;
      if (input.timeRange) {
        const parsed = parseTimeRange(input.timeRange);
        if (parsed) {
          startDate = parsed.startDate;
          endDate = parsed.endDate;
        }
      }

      if (input.projectPath && input.includeRelevanceScore) {
        const projectInput = {
          projectPath: input.projectPath,
          filePattern: input.filePattern,
          orderBy: 'recency' as const,
          limit: input.limit,
          fuzzyMatch: false
        };
        const result = await getConversationsByProject(projectInput);

        const transformedResult = {
          conversations: result.conversations.map(conv => ({
            ...conv,
            title: undefined,
            aiGeneratedSummary: undefined,
            relevanceScore: conv.relevanceScore
          })),
          totalFound: result.totalFound,
          filters: {
            limit: input.limit ?? 10,
            minLength: input.minLength ?? 100,
            hasCodeBlocks: input.hasCodeBlocks,
            keywords: input.keywords,
            projectPath: input.projectPath,
            filePattern: input.filePattern,
            relevantFiles: input.relevantFiles,
            includeAiSummaries: input.includeAiSummaries
          }
        };

        return {
          content: [{
            type: 'text',
            text: formatResponse(transformedResult, input.outputMode)
          }]
        };
      } else {
        const mappedInput = {
          limit: input.limit,
          minLength: input.minLength,
          minQualityScore: input.minQualityScore,
          format: 'both' as const,
          hasCodeBlocks: input.hasCodeBlocks,
          keywords: input.keywords,
          projectPath: input.projectPath,
          filePattern: input.filePattern,
          relevantFiles: input.relevantFiles,
          startDate,
          endDate,
          includeEmpty: input.includeEmpty,
          includeAiSummaries: input.includeAiSummaries,
          includeQualityScore: input.includeQualityScore,
          agent: 'all' as const
        };

        const result = await listConversations(mappedInput);
        return {
          content: [{
            type: 'text',
            text: formatResponse(result, input.outputMode)
          }]
        };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  }
);

server.tool(
  'get_conversation',
  'Retrieves the complete content of a specific Cursor conversation including all messages, code blocks, file references, title, and AI summary. WORKFLOW TIP: Use conversation IDs from list_conversations, search_conversations, or analytics breakdowns (files/languages arrays contain conversation IDs). Use summaryOnly=true to get enhanced summary data without full message content when you need to conserve context.',
  {
    conversationId: z.string().min(1).describe('Conversation ID from list_conversations, search_conversations, or analytics breakdowns'),
    summaryOnly: z.boolean().optional().default(false).describe('Return only enhanced summary data without full message content'),
    outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format: "json" for formatted JSON (default), "compact-json" for minified JSON')
  },
  async (input) => {
    try {
      const fullInput = {
        ...input,
        includeCodeBlocks: true,
        includeFileReferences: true,
        includeMetadata: false,
        resolveBubbles: true
      };
      const result = await getConversation(fullInput);

      return {
        content: [{
          type: 'text',
          text: formatResponse(result, input.outputMode)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  }
);

server.tool(
  'search_conversations',
  'Searches through Cursor chat content using exact text matching (NOT semantic search) to find relevant discussions. **WARNING: For project-specific searches, use list_conversations with projectPath instead of this tool!** This tool is for searching message content, not project filtering.\n\n**WHEN TO USE THIS TOOL:**\n- Searching for specific technical terms in message content (e.g., "useState", "async/await")\n- Finding conversations mentioning specific error messages\n- Searching for code patterns or function names\n\n**WHEN NOT TO USE THIS TOOL:**\n- ❌ DON\'T use query="project-name" - use list_conversations with projectPath instead\n- ❌ DON\'T search for project names in message content\n- ❌ DON\'T use this for project-specific filtering\n\nSearch methods (all use exact/literal text matching):\n1. Simple text matching: Use query parameter for literal string matching (e.g., "react hooks")\n2. Multi-keyword: Use keywords array with keywordOperator for exact matching\n3. LIKE patterns: Advanced pattern matching with SQL wildcards (% = any chars, _ = single char)\n4. Date range: Filter by message timestamps (YYYY-MM-DD format)\n\nIMPORTANT: When using date filters, call get_system_info first to know today\'s date.\n\nExamples: likePattern="%useState(%" for function calls, keywords=["typescript","interface"] with AND operator.',
  {
          query: z.string().optional().describe('Exact text matching - searches for literal string occurrences in MESSAGE CONTENT (e.g., "react hooks", "useState", "error message"). ❌ DON\'T use for project names - use list_conversations with projectPath instead!'),
    keywords: z.array(z.string().min(1)).optional().describe('Array of keywords for exact text matching - use with keywordOperator to find conversations with specific combinations'),
    keywordOperator: z.enum(['AND', 'OR']).optional().default('OR').describe('How to combine keywords: "AND" = all keywords must be present, "OR" = any keyword can be present'),
    likePattern: z.string().optional().describe('SQL LIKE pattern for advanced searches - use % for any characters, _ for single character. Examples: "%useState(%" for function calls, "%.tsx%" for file types'),
    startDate: z.string().optional().describe('Start date for search (YYYY-MM-DD). Note: Timestamps may be unreliable.'),
    endDate: z.string().optional().describe('End date for search (YYYY-MM-DD). Note: Timestamps may be unreliable.'),
    searchType: z.enum(['all', 'project', 'files', 'code']).optional().default('all').describe('Focus search on specific content types. Use "project" for project-specific searches that leverage file path context.'),
    maxResults: z.number().min(1).max(50).optional().default(10).describe('Maximum number of conversations to return'),
    includeCode: z.boolean().optional().default(true).describe('Include code blocks in search results'),
    outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format: "json" for formatted JSON (default), "compact-json" for minified JSON')
  },
  async (input) => {
    try {
      const hasSearchCriteria = (input.query && input.query.trim() !== '' && input.query.trim() !== '?') || input.keywords || input.likePattern;
      const hasDateFilter = input.startDate || input.endDate;
      const hasOtherFilters = input.searchType !== 'all';

      if (!hasSearchCriteria && !hasDateFilter && !hasOtherFilters) {
        throw new Error('At least one search criteria (query, keywords, likePattern), date filter (startDate, endDate), or search type filter must be provided');
      }

      const fullInput = {
        ...input,
        contextLines: 2,
        searchBubbles: true,
        format: 'both' as const,
        highlightMatches: true,
        projectSearch: input.searchType === 'project',
        fuzzyMatch: input.searchType === 'project',
        includePartialPaths: input.searchType === 'project',
        includeFileContent: false,
        minRelevanceScore: 0.1,
        orderBy: 'recency' as const
      };
      const result = await searchConversations(fullInput);

      return {
        content: [{
          type: 'text',
          text: formatResponse(result, input.outputMode)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  }
);

server.tool(
  'get_conversation_analytics',
  'Get comprehensive analytics and statistics about Cursor chats including usage patterns, file activity, programming language distribution, and temporal trends. **BEST PRACTICE: Use projectPath parameter for project-specific analytics** - this analyzes only conversations that worked on files in that project, providing much more relevant insights for understanding coding patterns, file usage, and development activity within a specific codebase. WORKFLOW TIP: Always include "files" and "languages" in breakdowns - these contain conversation IDs in their arrays that you can immediately use with get_conversation tool. Use includeConversationDetails=true when you need the full conversation ID list and basic metadata for follow-up analysis.',
  {
    scope: z.enum(['all', 'recent', 'project']).optional().default('all').describe('Analysis scope: all conversations, recent only, or project-specific. Use "project" with projectPath for focused project analysis.'),
    projectPath: z.string().optional().describe('**HIGHLY RECOMMENDED** Project/codebase name (e.g., "my-app") or full path for project-scoped analysis. When provided, analyzes only conversations that worked on files in that project, giving much more relevant insights about coding patterns and development activity.'),
    recentDays: z.number().min(1).max(365).optional().default(30).describe('Number of recent days to analyze (1-365)'),
    includeBreakdowns: z.array(z.enum(['files', 'languages', 'temporal', 'size'])).optional().default(['files', 'languages']).describe('Types of breakdowns to include in the analysis. IMPORTANT: "files" and "languages" breakdowns contain conversation IDs in their arrays - use these for follow-up analysis!'),
    includeConversationDetails: z.boolean().optional().default(false).describe('Include full conversation ID list and basic metadata (increases response size significantly)'),
    outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format: "json" for formatted JSON (default), "compact-json" for minified JSON')
  },
  async (input) => {
    try {
      const result = await getConversationAnalytics(input);
      return {
        content: [{
          type: 'text',
          text: formatResponse(result, input.outputMode)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  }
);


// ─────────────────────────────────────────────────────────────────────────────
// Git Linker Tools
// ─────────────────────────────────────────────────────────────────────────────

server.tool(
  'list_conversation_commits',
  'List git commits linked to Cursor conversations. Filter by conversation ID, project path, or file path. Returns conversation metadata plus linked commits with confidence scores and matched files. Use this to understand the git history associated with your conversations.',
  {
    conversationId: listConversationCommitsSchema.shape.conversationId,
    projectPath: listConversationCommitsSchema.shape.projectPath,
    filePath: listConversationCommitsSchema.shape.filePath,
    limit: listConversationCommitsSchema.shape.limit,
    outputMode: listConversationCommitsSchema.shape.outputMode,
  },
  async (input) => {
    try {
      const result = await listConversationCommits(input);
      return {
        content: [{
          type: 'text',
          text: formatResponse(result, input.outputMode)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  }
);

server.tool(
  'get_commit_conversations',
  'Get Cursor conversations linked to a specific git commit. Returns commit metadata plus linked conversations with confidence scores. Use this to find the discussion context for a commit.',
  {
    commitHash: getCommitConversationsSchema.shape.commitHash,
    outputMode: getCommitConversationsSchema.shape.outputMode,
  },
  async (input) => {
    try {
      const result = await getCommitConversations(input);
      return {
        content: [{
          type: 'text',
          text: formatResponse(result, input.outputMode)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  }
);

server.tool(
  'get_file_context',
  'Get conversation and commit context for a specific file. Returns conversations and commits that touched this file, with relevance indicators. Use keywords parameter to filter conversations by topic and get matching excerpts. NOTE: This returns metadata only - use file-reading tools to get actual file contents, and get_conversation to see full conversation details.',
  {
    filePath: getFileContextSchema.shape.filePath,
    keywords: getFileContextSchema.shape.keywords,
    limit: getFileContextSchema.shape.limit,
    outputMode: getFileContextSchema.shape.outputMode,
  },
  async (input) => {
    try {
      const result = await getFileContext(input);
      return {
        content: [{
          type: 'text',
          text: formatResponse(result, input.outputMode)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  }
);

server.tool(
  'link_conversation_commit',
  'Manually link a Cursor conversation to a git commit. Creates a manual link with specified confidence. Use this when the automatic linking missed a connection, or to explicitly associate a conversation with a commit.',
  {
    conversationId: linkConversationCommitSchema.shape.conversationId,
    commitHash: linkConversationCommitSchema.shape.commitHash,
    matchedFiles: linkConversationCommitSchema.shape.matchedFiles,
    confidence: linkConversationCommitSchema.shape.confidence,
  },
  async (input) => {
    try {
      const result = await linkConversationCommit(input);
      return {
        content: [{
          type: 'text',
          text: result.success
            ? `${result.message}\n\n${JSON.stringify(result.link, null, 2)}`
            : `Error: ${result.message}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      };
    }
  }
);

// Register prompts
registerPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);

} // End of else block for MCP server (CLI handled above)
