import { z } from 'zod';
import { CursorDatabaseReader } from '../database/reader.js';
import { ClaudeCodeReader } from '../database/claude-code-reader.js';
import type { BubbleMessage, ConversationFilters } from '../database/types.js';
import type { AgentName } from '../database/agent-types.js';
import { detectCursorDatabasePath } from '../utils/database-utils.js';
import { writeConversationFile, type ConversationFileStats } from '../utils/context-files.js';

// Input schema for list_conversations tool
export const listConversationsSchema = z.object({
  limit: z.number().min(1).max(1000).optional(),
  minLength: z.number().min(0).optional(),
  keywords: z.array(z.string()).optional(),
  hasCodeBlocks: z.boolean().optional(),
  format: z.enum(['legacy', 'modern', 'both']).optional(),
  includeEmpty: z.boolean().optional(),
  projectPath: z.string().optional(),
  filePattern: z.string().optional(),
  relevantFiles: z.array(z.string()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  includeAiSummaries: z.boolean().optional().default(true),
  agent: z.enum(['cursor', 'claude-code', 'all']).optional().default('all')
});

export type ListConversationsInput = z.infer<typeof listConversationsSchema>;

// Output type for list_conversations tool
export interface ListConversationsOutput {
  conversations: Array<{
    composerId: string;
    agent: AgentName;
    format: 'legacy' | 'modern' | 'jsonl';
    messageCount: number;
    hasCodeBlocks: boolean;
    relevantFiles: string[];
    attachedFolders: string[];
    firstMessage?: string;
    title?: string;
    aiGeneratedSummary?: string;
    size: number;
  }>;
  totalFound: number;
  filters: {
    limit: number;
    minLength: number;
    format: string;
    hasCodeBlocks?: boolean;
    keywords?: string[];
    projectPath?: string;
    filePattern?: string;
    relevantFiles?: string[];
    includeAiSummaries?: boolean;
    agent?: string;
  };
}

/**
 * List conversations with optional filters and ROWID-based ordering
 * Supports both Cursor and Claude Code agents
 */
export async function listConversations(input: ListConversationsInput): Promise<ListConversationsOutput> {
  const validatedInput = listConversationsSchema.parse(input);
  const agentFilter = validatedInput.agent ?? 'all';

  const allConversations: ListConversationsOutput['conversations'] = [];
  let totalFound = 0;

  // Get Cursor conversations if requested
  if (agentFilter === 'cursor' || agentFilter === 'all') {
    const cursorResult = await listCursorConversations(validatedInput);
    allConversations.push(...cursorResult.conversations);
    totalFound += cursorResult.totalFound;
  }

  // Get Claude Code conversations if requested
  if (agentFilter === 'claude-code' || agentFilter === 'all') {
    const claudeResult = await listClaudeCodeConversations(validatedInput);
    allConversations.push(...claudeResult.conversations);
    totalFound += claudeResult.totalFound;
  }

  // Sort by size descending (approximation of recency)
  allConversations.sort((a, b) => b.size - a.size);

  // Apply limit
  const limitedConversations = allConversations.slice(0, validatedInput.limit ?? 10);

  return {
    conversations: limitedConversations,
    totalFound,
    filters: {
      limit: validatedInput.limit ?? 10,
      minLength: validatedInput.minLength ?? 100,
      format: validatedInput.format ?? 'both',
      hasCodeBlocks: validatedInput.hasCodeBlocks,
      keywords: validatedInput.keywords,
      projectPath: validatedInput.projectPath,
      filePattern: validatedInput.filePattern,
      relevantFiles: validatedInput.relevantFiles,
      includeAiSummaries: validatedInput.includeAiSummaries,
      agent: agentFilter
    }
  };
}

/**
 * List Cursor conversations
 */
async function listCursorConversations(validatedInput: ListConversationsInput): Promise<ListConversationsOutput> {
  const dbPath = process.env.CURSOR_DB_PATH || detectCursorDatabasePath();
  const reader = new CursorDatabaseReader({ dbPath });

  try {
    await reader.connect();

    const filters: ConversationFilters = {
      minLength: validatedInput.minLength,
      format: validatedInput.format,
      hasCodeBlocks: validatedInput.hasCodeBlocks,
      keywords: validatedInput.keywords,
      projectPath: validatedInput.projectPath,
      filePattern: validatedInput.filePattern,
      relevantFiles: validatedInput.relevantFiles
    };

    // Add date range filter if provided
    if (validatedInput.startDate || validatedInput.endDate) {
      const start = validatedInput.startDate ? new Date(validatedInput.startDate) : new Date('1970-01-01');
      const end = validatedInput.endDate ? new Date(validatedInput.endDate) : new Date();
      filters.dateRange = { start, end };
    }

    const conversationIds = await reader.getConversationIds(filters);
    let limitedIds = conversationIds.slice(0, validatedInput.limit);

    // Apply date filtering if specified (post-query filtering due to unreliable timestamps)
    if (validatedInput.startDate || validatedInput.endDate) {
      const filteredIds = [];
      for (const composerId of limitedIds) {
        try {
          const conversation = await reader.getConversationById(composerId);
          if (!conversation) continue;

          const hasValidDate = checkConversationDateRange(
            conversation,
            validatedInput.startDate,
            validatedInput.endDate
          );

          if (hasValidDate) {
            filteredIds.push(composerId);
          }
        } catch {
          continue;
        }
      }
      limitedIds = filteredIds;
    }

    const conversations: ListConversationsOutput['conversations'] = [];
    for (const composerId of limitedIds) {
      try {
        const summary = await reader.getConversationSummary(composerId, {
          includeFirstMessage: true,
          maxFirstMessageLength: 150,
          includeTitle: true,
          includeAIGeneratedSummary: validatedInput.includeAiSummaries
        });

        if (summary) {
          conversations.push({
            composerId: summary.composerId,
            agent: 'cursor',
            format: summary.format,
            messageCount: summary.messageCount,
            hasCodeBlocks: summary.hasCodeBlocks,
            relevantFiles: summary.relevantFiles || [],
            attachedFolders: summary.attachedFolders || [],
            firstMessage: summary.firstMessage,
            title: summary.title,
            aiGeneratedSummary: summary.aiGeneratedSummary,
            size: summary.conversationSize
          });
        }
      } catch (error) {
        console.error(`Failed to get summary for conversation ${composerId}:`, error);
      }
    }

    return {
      conversations,
      totalFound: conversationIds.length,
      filters: {
        limit: validatedInput.limit ?? 10,
        minLength: validatedInput.minLength ?? 100,
        format: validatedInput.format ?? 'both'
      }
    };

  } finally {
    reader.close();
  }
}

/**
 * List Claude Code conversations
 */
async function listClaudeCodeConversations(validatedInput: ListConversationsInput): Promise<ListConversationsOutput> {
  const reader = new ClaudeCodeReader();

  try {
    if (!await reader.isAvailable()) {
      return { conversations: [], totalFound: 0, filters: { limit: 10, minLength: 0, format: 'jsonl' } };
    }

    let conversations: ListConversationsOutput['conversations'] = [];

    if (validatedInput.projectPath) {
      const claudeConvs = await reader.getConversationsByProject(validatedInput.projectPath);
      for (const conv of claudeConvs) {
        conversations.push({
          composerId: conv.conversationId,
          agent: 'claude-code',
          format: 'jsonl',
          messageCount: conv.messages.length,
          hasCodeBlocks: conv.messages.some(m => m.codeBlocks && m.codeBlocks.length > 0),
          relevantFiles: conv.files,
          attachedFolders: conv.folders ?? [],
          firstMessage: conv.messages[0]?.content?.substring(0, 150),
          title: conv.title,
          aiGeneratedSummary: undefined,
          size: JSON.stringify(conv).length
        });
      }
    } else {
      const convIds = await reader.getConversationIds();
      for (const convId of convIds.slice(0, validatedInput.limit ?? 10)) {
        const conv = await reader.getConversation(convId);
        if (conv) {
          conversations.push({
            composerId: conv.conversationId,
            agent: 'claude-code',
            format: 'jsonl',
            messageCount: conv.messages.length,
            hasCodeBlocks: conv.messages.some(m => m.codeBlocks && m.codeBlocks.length > 0),
            relevantFiles: conv.files,
            attachedFolders: conv.folders ?? [],
            firstMessage: conv.messages[0]?.content?.substring(0, 150),
            title: conv.title,
            aiGeneratedSummary: undefined,
            size: JSON.stringify(conv).length
          });
        }
      }
    }

    // Apply keyword filter if specified
    if (validatedInput.keywords && validatedInput.keywords.length > 0) {
      conversations = conversations.filter(conv => {
        const text = [conv.title, conv.firstMessage, conv.aiGeneratedSummary].filter(Boolean).join(' ').toLowerCase();
        return validatedInput.keywords!.some(kw => text.includes(kw.toLowerCase()));
      });
    }

    return {
      conversations,
      totalFound: conversations.length,
      filters: {
        limit: validatedInput.limit ?? 10,
        minLength: validatedInput.minLength ?? 0,
        format: 'jsonl'
      }
    };

  } catch (error) {
    console.error('Failed to list Claude Code conversations:', error);
    return { conversations: [], totalFound: 0, filters: { limit: 10, minLength: 0, format: 'jsonl' } };
  }
}

// Input schema for get_conversation tool
export const getConversationSchema = z.object({
  conversationId: z.string().min(1),
  includeCodeBlocks: z.boolean().optional().default(true),
  includeFileReferences: z.boolean().optional().default(true),
  includeMetadata: z.boolean().optional().default(false),
  resolveBubbles: z.boolean().optional().default(true),
  summaryOnly: z.boolean().optional().default(false)
});

export type GetConversationInput = z.infer<typeof getConversationSchema>;

// Output type for get_conversation tool
export interface GetConversationOutput {
  // File-based response (when not summaryOnly)
  filePath?: string;
  stats?: ConversationFileStats;
  guidance?: string;
  // Summary-only response
  conversation?: {
    composerId: string;
    format: 'legacy' | 'modern';
    messageCount: number;
    title?: string;
    aiGeneratedSummary?: string;
    messages?: Array<{
      type: number;
      text: string;
      bubbleId: string;
      relevantFiles?: string[];
      attachedFolders?: string[];
      codeBlocks?: Array<{
        language: string;
        code: string;
        filename?: string;
      }>;
    }>;
    codeBlocks?: Array<{
      language: string;
      code: string;
      filename?: string;
    }>;
    relevantFiles?: string[];
    attachedFolders?: string[];
    metadata?: {
      hasLoaded: boolean;
      storedSummary?: string;
      storedRichText?: string;
      size: number;
    };
  } | null;
}

/**
 * Get a specific conversation by ID
 * - summaryOnly=true: returns conversation object with summary data
 * - summaryOnly=false: writes full conversation to markdown file and returns path + stats
 */
export async function getConversation(input: GetConversationInput): Promise<GetConversationOutput> {
  const validatedInput = getConversationSchema.parse(input);

  const dbPath = process.env.CURSOR_DB_PATH || detectCursorDatabasePath();
  const reader = new CursorDatabaseReader({ dbPath });

  try {
    await reader.connect();

    // If summaryOnly is requested, return enhanced summary without full content
    if (validatedInput.summaryOnly) {
      const summary = await reader.getConversationSummary(validatedInput.conversationId, {
        includeTitle: true,
        includeAIGeneratedSummary: true,
        includeFirstMessage: true,
        includeLastMessage: true,
        maxFirstMessageLength: 200,
        maxLastMessageLength: 200
      });

      if (!summary) {
        return { conversation: null };
      }

      return {
        conversation: {
          composerId: summary.composerId,
          format: summary.format,
          messageCount: summary.messageCount,
          title: summary.title,
          aiGeneratedSummary: summary.aiGeneratedSummary,
          relevantFiles: validatedInput.includeFileReferences ? summary.relevantFiles : undefined,
          attachedFolders: validatedInput.includeFileReferences ? summary.attachedFolders : undefined,
          metadata: validatedInput.includeMetadata ? {
            hasLoaded: true,
            storedSummary: summary.storedSummary,
            storedRichText: summary.storedRichText,
            size: summary.conversationSize
          } : undefined
        }
      };
    }

    // Full content mode: write to file and return path
    const conversation = await reader.getConversationById(validatedInput.conversationId);

    if (!conversation) {
      return { conversation: null };
    }

    const summary = await reader.getConversationSummary(validatedInput.conversationId, {
      includeTitle: true,
      includeAIGeneratedSummary: true,
      includeFileList: true
    });

    const format = conversation.hasOwnProperty('_v') ? 'modern' : 'legacy';
    const messages: Array<{
      type: number;
      text: string;
      bubbleId?: string;
      codeBlocks?: Array<{ language: string; code: string; filename?: string }>;
    }> = [];

    if (format === 'legacy') {
      const legacyConv = conversation as any;
      const rawMessages = legacyConv.conversation || [];

      for (const msg of rawMessages) {
        messages.push({
          type: msg.type,
          text: msg.text,
          bubbleId: msg.bubbleId,
          codeBlocks: msg.suggestedCodeBlocks,
        });
      }
    } else {
      const modernConv = conversation as any;
      const headers = modernConv.fullConversationHeadersOnly || [];

      // Resolve all bubble messages for the file
      for (const header of headers) {
        try {
          const bubbleMessage = await reader.getBubbleMessage(modernConv.composerId, header.bubbleId);
          if (bubbleMessage) {
            messages.push({
              type: header.type,
              text: bubbleMessage.text,
              bubbleId: header.bubbleId,
              codeBlocks: bubbleMessage.suggestedCodeBlocks,
            });
          }
        } catch {
          // Skip failed bubbles
        }
      }
    }

    // Write to context file
    const { filePath, stats } = writeConversationFile(validatedInput.conversationId, {
      title: summary?.title,
      aiGeneratedSummary: summary?.aiGeneratedSummary,
      relevantFiles: summary?.relevantFiles,
      messages,
    });

    return {
      filePath,
      stats,
      guidance: `Conversation written to ${filePath}. Use Read tool to view specific sections or Grep to search for patterns. File has ${stats.messageCount} messages, ${stats.codeBlockCount} code blocks, ${stats.totalLines} lines (${stats.fileSize}).`,
    };

  } finally {
    reader.close();
  }
}

// Input schema for get_conversation_summary tool
export const getConversationSummarySchema = z.object({
  conversationId: z.string().min(1),
  includeFirstMessage: z.boolean().optional().default(false),
  includeLastMessage: z.boolean().optional().default(false),
  maxFirstMessageLength: z.number().min(1).max(1000).optional().default(200),
  maxLastMessageLength: z.number().min(1).max(1000).optional().default(200),
  includeMetadata: z.boolean().optional().default(false)
});

export type GetConversationSummaryInput = z.infer<typeof getConversationSummarySchema>;

// Output type for get_conversation_summary tool
export interface GetConversationSummaryOutput {
  summary: {
    composerId: string;
    format: 'legacy' | 'modern';
    messageCount: number;
    hasCodeBlocks: boolean;
    codeBlockCount?: number;
    conversationSize: number;
    firstMessage?: string;
    lastMessage?: string;
    storedSummary?: string;
    storedRichText?: string;
    relevantFiles?: string[];
    attachedFolders?: string[];
    metadata?: {
      totalCharacters: number;
      averageMessageLength: number;
    };
  } | null;
}

/**
 * Get conversation summary with optional first/last message content
 */
export async function getConversationSummary(input: GetConversationSummaryInput): Promise<GetConversationSummaryOutput> {
  const validatedInput = getConversationSummarySchema.parse(input);
  const dbPath = process.env.CURSOR_DB_PATH || detectCursorDatabasePath();
  const reader = new CursorDatabaseReader({ dbPath });

  try {
    await reader.connect();

    const summary = await reader.getConversationSummary(validatedInput.conversationId, {
      includeFirstMessage: validatedInput.includeFirstMessage,
      includeLastMessage: validatedInput.includeLastMessage,
      maxFirstMessageLength: validatedInput.maxFirstMessageLength,
      maxLastMessageLength: validatedInput.maxLastMessageLength
    });

    if (!summary) {
      return { summary: null };
    }

    return {
      summary: {
        composerId: summary.composerId,
        format: summary.format,
        messageCount: summary.messageCount,
        hasCodeBlocks: summary.hasCodeBlocks,
        codeBlockCount: summary.codeBlockCount,
        conversationSize: summary.conversationSize,
        firstMessage: summary.firstMessage,
        lastMessage: summary.lastMessage,
        storedSummary: summary.storedSummary,
        storedRichText: summary.storedRichText,
        relevantFiles: summary.relevantFiles,
        attachedFolders: summary.attachedFolders,
        metadata: validatedInput.includeMetadata ? {
          totalCharacters: summary.conversationSize,
          averageMessageLength: Math.round(summary.conversationSize / summary.messageCount)
        } : undefined
      }
    };

  } finally {
    reader.close();
  }
}

// Input schema for search_conversations tool
export const searchConversationsSchema = z.object({
  // Simple query (existing - backward compatible)
  query: z.string().optional(),

  // Multi-keyword search
  keywords: z.array(z.string().min(1)).optional(),
  keywordOperator: z.enum(['AND', 'OR']).optional().default('OR'),

  // LIKE pattern search (database-level)
  likePattern: z.string().optional(),

  // Date filtering
  startDate: z.string().optional(),
  endDate: z.string().optional(),

  // Existing options
  includeCode: z.boolean().optional().default(true),
  contextLines: z.number().min(0).max(10).optional().default(2),
  maxResults: z.number().min(1).max(100).optional().default(10),
  searchBubbles: z.boolean().optional().default(true),
  searchType: z.enum(['all', 'summarization', 'code', 'files', 'project']).optional().default('all'),
  format: z.enum(['legacy', 'modern', 'both']).optional().default('both'),
  highlightMatches: z.boolean().optional().default(true),
  projectSearch: z.boolean().optional().default(false),
  fuzzyMatch: z.boolean().optional().default(false),
  includePartialPaths: z.boolean().optional().default(true),
  includeFileContent: z.boolean().optional().default(false),
  minRelevanceScore: z.number().min(0).max(1).optional().default(0.1),
  orderBy: z.enum(['relevance', 'recency']).optional().default('relevance')
}).refine(
  (data) => {
    const hasSearchCriteria = (data.query && data.query.trim() !== '' && data.query.trim() !== '?') || data.keywords || data.likePattern;
    const hasDateFilter = data.startDate || data.endDate;
    const hasOtherFilters = data.searchType !== 'all';
    return hasSearchCriteria || hasDateFilter || hasOtherFilters;
  },
  { message: "At least one search criteria (query, keywords, likePattern), date filter (startDate, endDate), or search type filter must be provided" }
);

export type SearchConversationsInput = z.infer<typeof searchConversationsSchema>;

// Output type for search_conversations tool
export interface SearchConversationsOutput {
  conversations: Array<{
    composerId: string;
    format: 'legacy' | 'modern';
    messageCount: number;
    hasCodeBlocks: boolean;
    relevantFiles: string[];
    attachedFolders: string[];
    firstMessage?: string;
    title?: string;
    aiGeneratedSummary?: string;
    size: number;
    relevanceScore?: number;
    matchDetails?: {
      exactPathMatch: boolean;
      partialPathMatch: boolean;
      filePathMatch: boolean;
      fuzzyMatch: boolean;
      matchedPaths: string[];
      matchedFiles: string[];
    };
  }>;
  totalResults: number;
  query: string;
  searchOptions: {
    includeCode: boolean;
    contextLines: number;
    maxResults: number;
    searchBubbles: boolean;
    searchType: 'all' | 'summarization' | 'code' | 'files' | 'project';
    format: 'legacy' | 'modern' | 'both';
    highlightMatches: boolean;
    projectSearch?: boolean;
    fuzzyMatch?: boolean;
    includePartialPaths?: boolean;
    includeFileContent?: boolean;
    minRelevanceScore?: number;
    orderBy?: 'relevance' | 'recency';
  };
  debugInfo?: {
    totalConversationsScanned: number;
    averageRelevanceScore: number;
    matchTypeDistribution: {
      exactPath: number;
      partialPath: number;
      filePath: number;
      fuzzy: number;
    };
  };
}

/**
 * Search conversations with enhanced multi-keyword and LIKE pattern support
 */
export async function searchConversations(input: SearchConversationsInput): Promise<SearchConversationsOutput> {
  const validatedInput = searchConversationsSchema.parse(input);
  const dbPath = process.env.CURSOR_DB_PATH || detectCursorDatabasePath();
  const reader = new CursorDatabaseReader({ dbPath });

  try {
    await reader.connect();

    // Determine the search query for display purposes
    const displayQuery = validatedInput.query ||
                        (validatedInput.keywords ? validatedInput.keywords.join(` ${validatedInput.keywordOperator} `) : '') ||
                        validatedInput.likePattern ||
                        'advanced search';

    if (validatedInput.projectSearch && validatedInput.query) {
      // Handle project search (existing logic)
      const searchOptions = {
        fuzzyMatch: validatedInput.fuzzyMatch,
        includePartialPaths: validatedInput.includePartialPaths,
        includeFileContent: validatedInput.includeFileContent,
        minRelevanceScore: validatedInput.minRelevanceScore,
        orderBy: validatedInput.orderBy,
        limit: validatedInput.maxResults
      };

      const conversationIds = await reader.getConversationIds({
        format: validatedInput.format,
        projectPath: validatedInput.query
      });

      const conversations = [];
      const matchTypeDistribution = {
        exactPath: 0,
        partialPath: 0,
        filePath: 0,
        fuzzy: 0
      };

      let totalConversationsScanned = 0;
      let totalRelevanceScore = 0;

      for (const composerId of conversationIds.slice(0, validatedInput.maxResults * 2)) {
        try {
          totalConversationsScanned++;
          const conversation = await reader.getConversationById(composerId);
          if (!conversation) continue;

          const format = conversation.hasOwnProperty('_v') ? 'modern' : 'legacy';

          if (format === 'modern') {
            const modernConv = conversation as any;
            const headers = modernConv.fullConversationHeadersOnly || [];

            for (const header of headers.slice(0, 5)) {
              try {
                const bubbleMessage = await reader.getBubbleMessage(modernConv.composerId, header.bubbleId);
                if (bubbleMessage) {
                  (conversation as any).resolvedMessages = (conversation as any).resolvedMessages || [];
                  (conversation as any).resolvedMessages.push(bubbleMessage);
                }
              } catch (error) {
                continue;
              }
            }
          }

          const relevanceResult = calculateEnhancedProjectRelevance(
            conversation,
            validatedInput.query,
            {
              fuzzyMatch: validatedInput.fuzzyMatch || false,
              includePartialPaths: validatedInput.includePartialPaths || false,
              includeFileContent: validatedInput.includeFileContent || false
            }
          );

          if (relevanceResult.score >= (validatedInput.minRelevanceScore || 0.1)) {
            const summary = await reader.getConversationSummary(composerId, {
              includeFirstMessage: true,
              maxFirstMessageLength: 150
            });

            if (summary) {
              conversations.push({
                composerId: summary.composerId,
                format: summary.format,
                messageCount: summary.messageCount,
                hasCodeBlocks: summary.hasCodeBlocks,
                relevantFiles: summary.relevantFiles || [],
                attachedFolders: summary.attachedFolders || [],
                firstMessage: summary.firstMessage,
                size: summary.conversationSize,
                relevanceScore: relevanceResult.score,
                matchDetails: relevanceResult.details
              });

              totalRelevanceScore += relevanceResult.score;

              if (relevanceResult.details.exactPathMatch) matchTypeDistribution.exactPath++;
              if (relevanceResult.details.partialPathMatch) matchTypeDistribution.partialPath++;
              if (relevanceResult.details.filePathMatch) matchTypeDistribution.filePath++;
              if (relevanceResult.details.fuzzyMatch) matchTypeDistribution.fuzzy++;
            }
          }
        } catch (error) {
          continue;
        }
      }

      if (validatedInput.orderBy === 'relevance') {
        conversations.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      }

      return {
        conversations: conversations.slice(0, validatedInput.maxResults),
        totalResults: conversations.length,
        query: displayQuery,
        searchOptions: {
          includeCode: validatedInput.includeCode,
          contextLines: validatedInput.contextLines,
          maxResults: validatedInput.maxResults,
          searchBubbles: validatedInput.searchBubbles,
          searchType: validatedInput.searchType,
          format: validatedInput.format,
          highlightMatches: validatedInput.highlightMatches,
          projectSearch: validatedInput.projectSearch,
          fuzzyMatch: validatedInput.fuzzyMatch,
          includePartialPaths: validatedInput.includePartialPaths,
          includeFileContent: validatedInput.includeFileContent,
          minRelevanceScore: validatedInput.minRelevanceScore,
          orderBy: validatedInput.orderBy
        },
        debugInfo: {
          totalConversationsScanned,
          averageRelevanceScore: totalConversationsScanned > 0 ? totalRelevanceScore / totalConversationsScanned : 0,
          matchTypeDistribution
        }
      };
    } else {
      const hasSearchCriteria = (validatedInput.query && validatedInput.query.trim() !== '' && validatedInput.query.trim() !== '?') || validatedInput.keywords || validatedInput.likePattern;

      if (!hasSearchCriteria && (validatedInput.startDate || validatedInput.endDate)) {
        // Date-only search: get all conversations and filter by date
        const allConversationIds = await reader.getConversationIds({
          format: validatedInput.format
        });

        const conversations = [];
        for (const composerId of allConversationIds.slice(0, validatedInput.maxResults * 2)) {
          try {
            const conversation = await reader.getConversationById(composerId);
            if (!conversation) continue;

            // Apply date filtering
            const hasValidDate = checkConversationDateRange(
              conversation,
              validatedInput.startDate,
              validatedInput.endDate
            );

            if (!hasValidDate) continue;

            const summary = await reader.getConversationSummary(composerId, {
              includeFirstMessage: true,
              maxFirstMessageLength: 150,
              includeTitle: true,
              includeAIGeneratedSummary: true
            });

            if (summary) {
              conversations.push({
                composerId: summary.composerId,
                format: summary.format,
                messageCount: summary.messageCount,
                hasCodeBlocks: summary.hasCodeBlocks,
                relevantFiles: summary.relevantFiles || [],
                attachedFolders: summary.attachedFolders || [],
                firstMessage: summary.firstMessage,
                title: summary.title,
                aiGeneratedSummary: summary.aiGeneratedSummary,
                size: summary.conversationSize
              });

              if (conversations.length >= validatedInput.maxResults) break;
            }
          } catch (error) {
            console.error(`Failed to process conversation ${composerId}:`, error);
          }
        }

        return {
          conversations,
          totalResults: conversations.length,
          query: displayQuery,
          searchOptions: {
            includeCode: validatedInput.includeCode,
            contextLines: validatedInput.contextLines,
            maxResults: validatedInput.maxResults,
            searchBubbles: validatedInput.searchBubbles,
            searchType: validatedInput.searchType,
            format: validatedInput.format,
            highlightMatches: validatedInput.highlightMatches
          }
        };
      }

      // Handle enhanced search with keywords, LIKE patterns, or simple query
      const searchResults = await reader.searchConversationsEnhanced({
        query: validatedInput.query,
        keywords: validatedInput.keywords,
        keywordOperator: validatedInput.keywordOperator,
        likePattern: validatedInput.likePattern,
        includeCode: validatedInput.includeCode,
        contextLines: validatedInput.contextLines,
        maxResults: validatedInput.maxResults,
        searchBubbles: validatedInput.searchBubbles,
        searchType: validatedInput.searchType === 'project' ? 'all' : validatedInput.searchType,
        format: validatedInput.format,
        startDate: validatedInput.startDate,
        endDate: validatedInput.endDate
      });

      // Convert search results to conversation summaries for consistency
      const conversations = [];
      for (const result of searchResults) {
        try {
          // Apply date filtering if specified (post-query filtering due to unreliable timestamps)
          if (validatedInput.startDate || validatedInput.endDate) {
            const conversation = await reader.getConversationById(result.composerId);
            if (!conversation) continue;

            const hasValidDate = checkConversationDateRange(
              conversation,
              validatedInput.startDate,
              validatedInput.endDate
            );

            if (!hasValidDate) continue;
          }

          const summary = await reader.getConversationSummary(result.composerId, {
            includeFirstMessage: true,
            maxFirstMessageLength: 150,
            includeTitle: true,
            includeAIGeneratedSummary: true
          });

          if (summary) {
            conversations.push({
              composerId: summary.composerId,
              format: summary.format,
              messageCount: summary.messageCount,
              hasCodeBlocks: summary.hasCodeBlocks,
              relevantFiles: summary.relevantFiles || [],
              attachedFolders: summary.attachedFolders || [],
              firstMessage: summary.firstMessage,
              title: summary.title,
              aiGeneratedSummary: summary.aiGeneratedSummary,
              size: summary.conversationSize
            });
          }
        } catch (error) {
          console.error(`Failed to get summary for conversation ${result.composerId}:`, error);
        }
      }

      return {
        conversations,
        totalResults: conversations.length,
        query: displayQuery,
        searchOptions: {
          includeCode: validatedInput.includeCode,
          contextLines: validatedInput.contextLines,
          maxResults: validatedInput.maxResults,
          searchBubbles: validatedInput.searchBubbles,
          searchType: validatedInput.searchType,
          format: validatedInput.format,
          highlightMatches: validatedInput.highlightMatches
        }
      };
    }

  } finally {
    reader.close();
  }
}

// Get bubble message tool schema and types
export const getBubbleMessageSchema = z.object({
  composerId: z.string().min(1).describe('The composer ID of the conversation containing the bubble message'),
  bubbleId: z.string().min(1).describe('The unique bubble ID of the message to retrieve'),
  includeMetadata: z.boolean().optional().default(false).describe('Include additional metadata about the bubble message'),
  includeCodeBlocks: z.boolean().optional().default(true).describe('Include code blocks in the response'),
  includeFileReferences: z.boolean().optional().default(true).describe('Include file references and attached folders'),
  resolveReferences: z.boolean().optional().default(false).describe('Attempt to resolve file references to actual content')
});

export type GetBubbleMessageInput = z.infer<typeof getBubbleMessageSchema>;

export interface GetBubbleMessageOutput {
  bubbleMessage: BubbleMessage | null;
  metadata?: {
    composerId: string;
    bubbleId: string;
    messageType: 'user' | 'assistant' | 'unknown';
    hasCodeBlocks: boolean;
    codeBlockCount: number;
    hasFileReferences: boolean;
    fileReferenceCount: number;
    hasAttachedFolders: boolean;
    attachedFolderCount: number;
    messageLength: number;
    timestamp?: string;
  };
  error?: string;
}

/**
 * Get a specific bubble message from a modern format conversation
 */
export async function getBubbleMessage(input: GetBubbleMessageInput): Promise<GetBubbleMessageOutput> {
  // Validate input
  const validatedInput = getBubbleMessageSchema.parse(input);

  // Create database reader
  const dbPath = process.env.CURSOR_DB_PATH || detectCursorDatabasePath();
  const reader = new CursorDatabaseReader({ dbPath });

  try {
    // Connect to database
    await reader.connect();

    // Get the bubble message
    const bubbleMessage = await reader.getBubbleMessage(validatedInput.composerId, validatedInput.bubbleId);

    if (!bubbleMessage) {
      return {
        bubbleMessage: null,
        error: `Bubble message not found: ${validatedInput.bubbleId} in conversation ${validatedInput.composerId}`
      };
    }

    // Build metadata if requested
    let metadata;
    if (validatedInput.includeMetadata) {
      const hasCodeBlocks = !!(bubbleMessage.suggestedCodeBlocks && bubbleMessage.suggestedCodeBlocks.length > 0);
      const hasFileReferences = !!(bubbleMessage.relevantFiles && bubbleMessage.relevantFiles.length > 0);
      const hasAttachedFolders = !!(bubbleMessage.attachedFoldersNew && bubbleMessage.attachedFoldersNew.length > 0);

      const messageType: 'user' | 'assistant' | 'unknown' =
        bubbleMessage.type === 0 ? 'user' :
        bubbleMessage.type === 1 ? 'assistant' : 'unknown';

      metadata = {
        composerId: validatedInput.composerId,
        bubbleId: validatedInput.bubbleId,
        messageType,
        hasCodeBlocks,
        codeBlockCount: bubbleMessage.suggestedCodeBlocks?.length || 0,
        hasFileReferences,
        fileReferenceCount: bubbleMessage.relevantFiles?.length || 0,
        hasAttachedFolders,
        attachedFolderCount: bubbleMessage.attachedFoldersNew?.length || 0,
        messageLength: bubbleMessage.text.length,
        timestamp: bubbleMessage.timestamp
      };
    }

    return {
      bubbleMessage,
      metadata
    };

  } finally {
    // Always close the database connection
    reader.close();
  }
}

// Input schema for get_recent_conversations tool
export const getRecentConversationsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(10),
  includeEmpty: z.boolean().optional().default(false),
  format: z.enum(['legacy', 'modern', 'both']).optional().default('both'),
  includeFirstMessage: z.boolean().optional().default(true),
  maxFirstMessageLength: z.number().min(10).max(500).optional().default(150),
  includeMetadata: z.boolean().optional().default(false)
});

export type GetRecentConversationsInput = z.infer<typeof getRecentConversationsSchema>;

// Output type for get_recent_conversations tool
export interface GetRecentConversationsOutput {
  conversations: Array<{
    composerId: string;
    format: 'legacy' | 'modern';
    messageCount: number;
    hasCodeBlocks: boolean;
    relevantFiles: string[];
    attachedFolders: string[];
    firstMessage?: string;
    size: number;
    metadata?: {
      hasLoaded: boolean;
      totalCharacters: number;
      averageMessageLength: number;
      codeBlockCount: number;
      fileReferenceCount: number;
      attachedFolderCount: number;
    };
  }>;
  totalFound: number;
  requestedLimit: number;
  timestamp: string;
}

/**
 * Get recent Cursor conversations ordered by ROWID (most recent first)
 */
export async function getRecentConversations(input: GetRecentConversationsInput): Promise<GetRecentConversationsOutput> {
  // Validate input
  const validatedInput = getRecentConversationsSchema.parse(input);

  // Create database reader
  const dbPath = process.env.CURSOR_DB_PATH || detectCursorDatabasePath();
  const reader = new CursorDatabaseReader({
    dbPath,
    minConversationSize: validatedInput.includeEmpty ? 0 : 5000
  });

  try {
    // Connect to database
    await reader.connect();

    // Build minimal filters for recent conversations
    const filters: ConversationFilters = {
      minLength: validatedInput.includeEmpty ? 0 : 5000,
      format: validatedInput.format
    };

    // Get conversation IDs (already ordered by ROWID DESC)
    const conversationIds = await reader.getConversationIds(filters);

    // Limit results
    const limitedIds = conversationIds.slice(0, validatedInput.limit);

    // Get conversation summaries
    const conversations = [];
    for (const composerId of limitedIds) {
      try {
        const summary = await reader.getConversationSummary(composerId, {
          includeFirstMessage: validatedInput.includeFirstMessage,
          maxFirstMessageLength: validatedInput.maxFirstMessageLength,
          includeFileList: true,
          includeCodeBlockCount: true
        });

        if (summary) {
          const conversationData: any = {
            composerId: summary.composerId,
            format: summary.format,
            messageCount: summary.messageCount,
            hasCodeBlocks: summary.hasCodeBlocks,
            relevantFiles: summary.relevantFiles,
            attachedFolders: summary.attachedFolders,
            firstMessage: summary.firstMessage,
            size: summary.conversationSize
          };

          // Add metadata if requested
          if (validatedInput.includeMetadata) {
            conversationData.metadata = {
              hasLoaded: true,
              totalCharacters: summary.conversationSize,
              averageMessageLength: summary.messageCount > 0 ? Math.round(summary.conversationSize / summary.messageCount) : 0,
              codeBlockCount: summary.codeBlockCount || 0,
              fileReferenceCount: summary.relevantFiles.length,
              attachedFolderCount: summary.attachedFolders.length
            };
          }

          conversations.push(conversationData);
        }
      } catch (error) {
        console.error(`Failed to get summary for conversation ${composerId}:`, error);
        // Continue with other conversations
      }
    }

    return {
      conversations,
      totalFound: conversationIds.length,
      requestedLimit: validatedInput.limit,
      timestamp: new Date().toISOString()
    };

  } finally {
    // Always close the database connection
    reader.close();
  }
}

// Input schema for get_conversations_by_project tool
export const getConversationsByProjectSchema = z.object({
  projectPath: z.string().min(1),
  filePattern: z.string().optional(),
  exactFilePath: z.string().optional(),
  orderBy: z.enum(['recency', 'relevance']).optional().default('recency'),
  limit: z.number().min(1).max(1000).optional().default(50),
  fuzzyMatch: z.boolean().optional().default(false)
});

export type GetConversationsByProjectInput = z.infer<typeof getConversationsByProjectSchema>;

// Output type for get_conversations_by_project tool
export interface GetConversationsByProjectOutput {
  conversations: Array<{
    composerId: string;
    format: 'legacy' | 'modern';
    messageCount: number;
    hasCodeBlocks: boolean;
    relevantFiles: string[];
    attachedFolders: string[];
    firstMessage?: string;
    size: number;
    relevanceScore?: number;
  }>;
  totalFound: number;
  filters: {
    projectPath: string;
    filePattern?: string;
    exactFilePath?: string;
    orderBy: string;
    limit: number;
  };
}

/**
 * Get conversations filtered by project path, attached folders, or relevant files
 */
export async function getConversationsByProject(input: GetConversationsByProjectInput): Promise<GetConversationsByProjectOutput> {
  // Validate input
  const validatedInput = getConversationsByProjectSchema.parse(input);

  // Create database reader
  const dbPath = process.env.CURSOR_DB_PATH || detectCursorDatabasePath();
  const reader = new CursorDatabaseReader({
    dbPath,
    minConversationSize: 5000 // Default minimum size for project conversations
  });

  try {
    // Connect to database
    await reader.connect();

    // Get conversation IDs with project-specific filtering
    const conversationResults = await reader.getConversationIdsByProject(
      validatedInput.projectPath,
      {
        filePattern: validatedInput.filePattern,
        exactFilePath: validatedInput.exactFilePath,
        orderBy: validatedInput.orderBy,
        limit: validatedInput.limit,
        format: 'both', // Support both legacy and modern formats
        fuzzyMatch: validatedInput.fuzzyMatch
      }
    );

    // Get conversation summaries
    const conversations = [];
    for (const result of conversationResults) {
      try {
        const summary = await reader.getConversationSummary(result.composerId, {
          includeFirstMessage: true,
          maxFirstMessageLength: 100,
          includeFileList: true,
          includeCodeBlockCount: true
        });

        if (summary) {
          conversations.push({
            composerId: summary.composerId,
            format: summary.format,
            messageCount: summary.messageCount,
            hasCodeBlocks: summary.hasCodeBlocks,
            relevantFiles: summary.relevantFiles,
            attachedFolders: summary.attachedFolders,
            firstMessage: summary.firstMessage,
            size: summary.conversationSize,
            relevanceScore: result.relevanceScore
          });
        }
      } catch (error) {
        console.error(`Failed to get summary for conversation ${result.composerId}:`, error);
        // Continue with other conversations
      }
    }

    return {
      conversations,
      totalFound: conversationResults.length,
      filters: {
        projectPath: validatedInput.projectPath,
        filePattern: validatedInput.filePattern,
        exactFilePath: validatedInput.exactFilePath,
        orderBy: validatedInput.orderBy,
        limit: validatedInput.limit
      }
    };

  } finally {
    // Always close the database connection
    reader.close();
  }
}

// Input schema for search_conversations_by_project tool (improved project search)
export const searchConversationsByProjectSchema = z.object({
  projectQuery: z.string().min(1),
  fuzzyMatch: z.boolean().optional().default(true),
  includePartialPaths: z.boolean().optional().default(true),
  includeFileContent: z.boolean().optional().default(false),
  minRelevanceScore: z.number().min(0).max(10).optional().default(1),
  orderBy: z.enum(['relevance', 'recency']).optional().default('relevance'),
  limit: z.number().min(1).max(1000).optional().default(50),
  includeDebugInfo: z.boolean().optional().default(false)
});

export type SearchConversationsByProjectInput = z.infer<typeof searchConversationsByProjectSchema>;

// Output type for search_conversations_by_project tool
export interface SearchConversationsByProjectOutput {
  conversations: Array<{
    composerId: string;
    format: 'legacy' | 'modern';
    messageCount: number;
    hasCodeBlocks: boolean;
    relevantFiles: string[];
    attachedFolders: string[];
    firstMessage?: string;
    size: number;
    relevanceScore: number;
    matchDetails?: {
      exactPathMatch: boolean;
      partialPathMatch: boolean;
      filePathMatch: boolean;
      fuzzyMatch: boolean;
      matchedPaths: string[];
      matchedFiles: string[];
    };
  }>;
  totalFound: number;
  searchQuery: string;
  searchOptions: {
    fuzzyMatch: boolean;
    includePartialPaths: boolean;
    includeFileContent: boolean;
    minRelevanceScore: number;
    orderBy: string;
    limit: number;
  };
  debugInfo?: {
    totalConversationsScanned: number;
    averageRelevanceScore: number;
    matchTypeDistribution: {
      exactPath: number;
      partialPath: number;
      filePath: number;
      fuzzy: number;
    };
  };
}

/**
 * Enhanced project search with fuzzy matching and flexible path matching
 */
export async function searchConversationsByProject(input: SearchConversationsByProjectInput): Promise<SearchConversationsByProjectOutput> {
  // Validate input
  const validatedInput = searchConversationsByProjectSchema.parse(input);

  // Create database reader
  const dbPath = process.env.CURSOR_DB_PATH || detectCursorDatabasePath();
  const reader = new CursorDatabaseReader({
    dbPath,
    minConversationSize: 1000 // Lower threshold for broader search
  });

  try {
    // Connect to database
    await reader.connect();

    // Get all conversations for flexible searching
    const allConversationIds = await reader.getConversationIds({
      format: 'both',
      minLength: 1000
    });

    const results: Array<{
      composerId: string;
      format: 'legacy' | 'modern';
      messageCount: number;
      hasCodeBlocks: boolean;
      relevantFiles: string[];
      attachedFolders: string[];
      firstMessage?: string;
      size: number;
      relevanceScore: number;
      matchDetails?: any;
    }> = [];

    let totalScanned = 0;
    let matchTypeDistribution = {
      exactPath: 0,
      partialPath: 0,
      filePath: 0,
      fuzzy: 0
    };

    // Process conversations in batches to avoid memory issues
    const batchSize = 100;
    for (let i = 0; i < allConversationIds.length; i += batchSize) {
      const batch = allConversationIds.slice(i, i + batchSize);

      for (const composerId of batch) {
        totalScanned++;

        try {
          const conversation = await reader.getConversationById(composerId);
          if (!conversation) continue;

          // For modern format conversations, we need to resolve bubble messages to get file paths
          let enrichedConversation = conversation as any;

          if (conversation.hasOwnProperty('_v')) {
            // Modern format - resolve bubble messages
            const headers = (conversation as any).fullConversationHeadersOnly || [];
            const bubbleMessages: any[] = [];

            // Resolve a few bubble messages to get file paths (limit to avoid performance issues)
            const maxBubblesToResolve = Math.min(headers.length, 10);
            for (let i = 0; i < maxBubblesToResolve; i++) {
              const header = headers[i];
              try {
                const bubbleMessage = await reader.getBubbleMessage(composerId, header.bubbleId);
                if (bubbleMessage) {
                  bubbleMessages.push(bubbleMessage);
                }
              } catch (error) {
                // Continue with other bubbles if one fails
                console.error(`Failed to resolve bubble ${header.bubbleId}:`, error);
              }
            }

            // Add resolved messages to the conversation object for matching
            enrichedConversation = {
              ...conversation,
              messages: bubbleMessages
            };
          }

          const matchResult = calculateEnhancedProjectRelevance(
            enrichedConversation,
            validatedInput.projectQuery,
            {
              fuzzyMatch: validatedInput.fuzzyMatch,
              includePartialPaths: validatedInput.includePartialPaths,
              includeFileContent: validatedInput.includeFileContent
            }
          );

          if (matchResult.score >= validatedInput.minRelevanceScore) {
            const summary = await reader.getConversationSummary(composerId, {
              includeFirstMessage: true,
              maxFirstMessageLength: 100,
              includeFileList: true,
              includeCodeBlockCount: true
            });

            if (summary) {
              // Update match type distribution
              if (matchResult.details.exactPathMatch) matchTypeDistribution.exactPath++;
              if (matchResult.details.partialPathMatch) matchTypeDistribution.partialPath++;
              if (matchResult.details.filePathMatch) matchTypeDistribution.filePath++;
              if (matchResult.details.fuzzyMatch) matchTypeDistribution.fuzzy++;

              results.push({
                composerId: summary.composerId,
                format: summary.format,
                messageCount: summary.messageCount,
                hasCodeBlocks: summary.hasCodeBlocks,
                relevantFiles: summary.relevantFiles,
                attachedFolders: summary.attachedFolders,
                firstMessage: summary.firstMessage,
                size: summary.conversationSize,
                relevanceScore: matchResult.score,
                matchDetails: validatedInput.includeDebugInfo ? matchResult.details : undefined
              });
            }
          }
        } catch (error) {
          console.error(`Failed to process conversation ${composerId}:`, error);
          // Continue with other conversations
        }
      }
    }

    // Sort by relevance or recency
    if (validatedInput.orderBy === 'relevance') {
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    } else {
      // For recency, we rely on the original ROWID order from getConversationIds
      // which is already in descending order (most recent first)
    }

    const limitedResults = results.slice(0, validatedInput.limit);

    const debugInfo = validatedInput.includeDebugInfo ? {
      totalConversationsScanned: totalScanned,
      averageRelevanceScore: results.length > 0 ? results.reduce((sum, r) => sum + r.relevanceScore, 0) / results.length : 0,
      matchTypeDistribution
    } : undefined;

    return {
      conversations: limitedResults,
      totalFound: results.length,
      searchQuery: validatedInput.projectQuery,
      searchOptions: {
        fuzzyMatch: validatedInput.fuzzyMatch,
        includePartialPaths: validatedInput.includePartialPaths,
        includeFileContent: validatedInput.includeFileContent,
        minRelevanceScore: validatedInput.minRelevanceScore,
        orderBy: validatedInput.orderBy,
        limit: validatedInput.limit
      },
      debugInfo
    };

  } finally {
    // Always close the database connection
    reader.close();
  }
}

/**
 * Calculate enhanced project relevance with fuzzy matching and flexible path matching
 */
function calculateEnhancedProjectRelevance(
  conversation: any,
  projectQuery: string,
  options: {
    fuzzyMatch: boolean;
    includePartialPaths: boolean;
    includeFileContent: boolean;
  }
): {
  score: number;
  details: {
    exactPathMatch: boolean;
    partialPathMatch: boolean;
    filePathMatch: boolean;
    fuzzyMatch: boolean;
    matchedPaths: string[];
    matchedFiles: string[];
  };
} {
  let score = 0;
  const details = {
    exactPathMatch: false,
    partialPathMatch: false,
    filePathMatch: false,
    fuzzyMatch: false,
    matchedPaths: [] as string[],
    matchedFiles: [] as string[]
  };

  const queryLower = projectQuery.toLowerCase();
  const queryParts = queryLower.split(/[-_\s]+/); // Split on common separators

  // Helper function for fuzzy matching
  const fuzzyMatch = (text: string, query: string): number => {
    const textLower = text.toLowerCase();

    // Exact match
    if (textLower.includes(query)) return 10;

    // Check if all query parts are present
    const allPartsPresent = queryParts.every(part => textLower.includes(part));
    if (allPartsPresent) return 8;

    // Check for partial matches
    const partialMatches = queryParts.filter(part => textLower.includes(part)).length;
    if (partialMatches > 0) return (partialMatches / queryParts.length) * 6;

    // Levenshtein-like similarity for very fuzzy matching
    const similarity = calculateSimilarity(textLower, query);
    if (similarity > 0.6) return similarity * 4;

    return 0;
  };

  // Helper function to process files and folders
  const processFiles = (files: string[], scoreMultiplier: number = 1) => {
    if (!files || !Array.isArray(files)) return;

    for (const file of files) {
      if (typeof file === 'string') {
        const fileName = file.split('/').pop() || file;
        const filePath = file.toLowerCase();
        const fileNameLower = fileName.toLowerCase();

        // Check if file path contains project query
        if (filePath.includes(queryLower)) {
          score += 10 * scoreMultiplier;
          details.filePathMatch = true;
          details.matchedFiles.push(file);
        }
        // Check file name
        else if (fileNameLower.includes(queryLower)) {
          score += 8 * scoreMultiplier;
          details.filePathMatch = true;
          details.matchedFiles.push(file);
        }
        // Fuzzy match on file paths
        else if (options.fuzzyMatch) {
          const fuzzyScore = Math.max(
            fuzzyMatch(file, queryLower),
            fuzzyMatch(fileName, queryLower)
          );
          if (fuzzyScore > 0) {
            score += fuzzyScore * 0.5 * scoreMultiplier; // Lower weight for file matches
            details.fuzzyMatch = true;
            details.matchedFiles.push(file);
          }
        }
      }
    }
  };

  const processFolders = (folders: string[], scoreMultiplier: number = 1) => {
    if (!folders || !Array.isArray(folders)) return;

    for (const folder of folders) {
      if (typeof folder === 'string') {
        const folderName = folder.split('/').pop() || folder; // Get last part of path
        const folderLower = folder.toLowerCase();

        // Exact path match
        if (folderLower === queryLower || folderName.toLowerCase() === queryLower) {
          score += 20 * scoreMultiplier;
          details.exactPathMatch = true;
          details.matchedPaths.push(folder);
        }
        // Partial path match
        else if (options.includePartialPaths && (folderLower.includes(queryLower) || folderName.toLowerCase().includes(queryLower))) {
          score += 15 * scoreMultiplier;
          details.partialPathMatch = true;
          details.matchedPaths.push(folder);
        }
        // Fuzzy match
        else if (options.fuzzyMatch) {
          const fuzzyScore = Math.max(
            fuzzyMatch(folder, queryLower),
            fuzzyMatch(folderName, queryLower)
          );
          if (fuzzyScore > 0) {
            score += fuzzyScore * scoreMultiplier;
            details.fuzzyMatch = true;
            details.matchedPaths.push(folder);
          }
        }
      }
    }
  };

  // Check top-level attachedFoldersNew and relevantFiles (legacy format)
  processFolders(conversation.attachedFoldersNew);
  processFiles(conversation.relevantFiles);

  // Check legacy conversation messages
  if (conversation.conversation && Array.isArray(conversation.conversation)) {
    for (const message of conversation.conversation) {
      processFolders(message.attachedFoldersNew, 0.8);
      processFiles(message.relevantFiles, 0.8);

      // Check message content if enabled
      if (options.includeFileContent && message.text && typeof message.text === 'string') {
        const textLower = message.text.toLowerCase();
        if (textLower.includes(queryLower)) {
          score += 2; // Lower weight for content matches
        }
      }
    }
  }

  // Check modern format messages (this is the key fix!)
  if (conversation.messages && Array.isArray(conversation.messages)) {
    for (const message of conversation.messages) {
      processFolders(message.attachedFolders, 0.8);
      processFiles(message.relevantFiles, 0.8);

      // Check message content if enabled
      if (options.includeFileContent && message.text && typeof message.text === 'string') {
        const textLower = message.text.toLowerCase();
        if (textLower.includes(queryLower)) {
          score += 2; // Lower weight for content matches
        }
      }
    }
  }

  // Check modern format bubbles for additional context
  if (conversation._v && conversation.bubbles && Array.isArray(conversation.bubbles)) {
    for (const bubble of conversation.bubbles) {
      processFolders(bubble.attachedFoldersNew, 0.5);
      processFiles(bubble.relevantFiles, 0.5);
    }
  }

  return {
    score: Math.max(score, 0),
    details
  };
}

/**
 * Calculate string similarity (simplified Levenshtein-based)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Check if a conversation falls within the specified date range
 */
function checkConversationDateRange(conversation: any, startDate?: string, endDate?: string): boolean {
  if (!startDate && !endDate) return true;

  const start = startDate ? new Date(startDate) : new Date('1970-01-01');
  const end = endDate ? new Date(endDate) : new Date();

  // Check if conversation is legacy or modern format
  const isLegacy = conversation.conversation && Array.isArray(conversation.conversation);

  if (isLegacy) {
    // Legacy format: check timestamps in conversation.conversation array
    for (const message of conversation.conversation) {
      if (message.timestamp) {
        const messageDate = new Date(message.timestamp);
        if (messageDate >= start && messageDate <= end) {
          return true;
        }
      }
    }
  } else {
    // Modern format: would need to resolve bubble messages to check timestamps
    // For now, return true to include all modern conversations when date filtering
    // since resolving all bubble messages would be too expensive
    return true;
  }

  // If no valid timestamps found, include the conversation
  return true;
}