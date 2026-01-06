/**
 * MCP tools for the Conversation ↔ Git Linker feature
 */

import { z } from 'zod';
import { LinksDatabase } from './links-database.js';
import type {
  ConversationCommitsResult,
  CommitConversationsResult,
  FileContextResult,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schema definitions
// ─────────────────────────────────────────────────────────────────────────────

export const listConversationCommitsSchema = z.object({
  conversationId: z.string().optional().describe('Specific conversation ID to get commits for'),
  projectPath: z.string().optional().describe('Filter by project path or workspace root'),
  filePath: z.string().optional().describe('Filter by file path (finds conversations/commits touching this file)'),
  limit: z.number().min(1).max(50).optional().default(10).describe('Maximum number of results'),
  outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format'),
});

export const getCommitConversationsSchema = z.object({
  commitHash: z.string().min(1).describe('Git commit hash to get linked conversations for'),
  outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format'),
});

export const getFileContextSchema = z.object({
  filePath: z.string().min(1).describe('File path to get context for'),
  keywords: z.array(z.string()).optional().describe('Filter by keywords (e.g., ["JWT", "auth"]) - returns matching excerpts from searchableText'),
  limit: z.number().min(1).max(20).optional().default(5).describe('Maximum conversations/commits to return'),
  outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format'),
});

export const linkConversationCommitSchema = z.object({
  conversationId: z.string().min(1).describe('Conversation ID to link'),
  commitHash: z.string().min(1).describe('Commit hash to link'),
  matchedFiles: z.array(z.string()).optional().describe('Files that match between conversation and commit'),
  confidence: z.number().min(0).max(1).optional().default(1.0).describe('Link confidence score (0-1)'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool implementations
// ─────────────────────────────────────────────────────────────────────────────

export type ListConversationCommitsInput = z.infer<typeof listConversationCommitsSchema>;

/**
 * List commits linked to conversations, with optional filters
 */
export async function listConversationCommits(
  input: ListConversationCommitsInput
): Promise<{
  results: ConversationCommitsResult[];
  totalFound: number;
  filters: Record<string, unknown>;
}> {
  const linksDb = new LinksDatabase();

  try {
    await linksDb.connect();

    const results: ConversationCommitsResult[] = [];

    if (input.conversationId) {
      // Get specific conversation
      const conversation = linksDb.getConversation(input.conversationId);
      const links = linksDb.getLinksForConversation(input.conversationId);

      results.push({
        conversation,
        commits: links.map(l => ({ commit: l.commit, link: l.link })),
      });
    } else {
      // Find conversations by filters
      const conversations = linksDb.findConversations({
        workspaceRoot: input.projectPath,
        file: input.filePath,
        limit: input.limit,
      });

      for (const conversation of conversations) {
        const links = linksDb.getLinksForConversation(conversation.conversationId);
        results.push({
          conversation,
          commits: links.map(l => ({ commit: l.commit, link: l.link })),
        });
      }
    }

    return {
      results,
      totalFound: results.length,
      filters: {
        conversationId: input.conversationId,
        projectPath: input.projectPath,
        filePath: input.filePath,
        limit: input.limit,
      },
    };
  } finally {
    linksDb.close();
  }
}

export type GetCommitConversationsInput = z.infer<typeof getCommitConversationsSchema>;

/**
 * Get conversations linked to a specific commit
 */
export async function getCommitConversations(
  input: GetCommitConversationsInput
): Promise<CommitConversationsResult> {
  const linksDb = new LinksDatabase();

  try {
    await linksDb.connect();

    const commit = linksDb.getCommit(input.commitHash);
    const links = linksDb.getLinksForCommit(input.commitHash);

    return {
      commit,
      conversations: links.map(l => ({
        conversation: l.conversation,
        link: l.link,
      })),
    };
  } finally {
    linksDb.close();
  }
}

export type GetFileContextInput = z.infer<typeof getFileContextSchema>;

/**
 * Get conversations and commits related to a specific file
 */
export async function getFileContext(
  input: GetFileContextInput
): Promise<FileContextResult> {
  const linksDb = new LinksDatabase();

  try {
    await linksDb.connect();

    const context = linksDb.getFileContext(input.filePath, {
      limit: input.limit,
      keywords: input.keywords,
    });

    const hasKeywords = input.keywords && input.keywords.length > 0;
    const guidance = hasKeywords
      ? `Found conversations matching keywords [${input.keywords!.join(', ')}] for "${input.filePath}". Check keywordMatches for relevant excerpts. Use get_conversation for full details.`
      : `This tool returns metadata about conversations and commits related to the file "${input.filePath}". To view the actual file contents, use file-reading tools. To see full conversation details, use get_conversation with the conversation IDs returned here.`;

    return {
      filePath: input.filePath,
      conversations: context.conversations,
      commits: context.commits,
      guidance,
    };
  } finally {
    linksDb.close();
  }
}

export type LinkConversationCommitInput = z.infer<typeof linkConversationCommitSchema>;

/**
 * Manually link a conversation to a commit (requires user confirmation)
 */
export async function linkConversationCommit(
  input: LinkConversationCommitInput
): Promise<{
  success: boolean;
  message: string;
  link?: {
    conversationId: string;
    commitHash: string;
    matchedFiles: string[];
    confidence: number;
    status: 'manual';
  };
}> {
  const linksDb = new LinksDatabase();

  try {
    await linksDb.connect();

    // Verify at least one side exists
    const conversation = linksDb.getConversation(input.conversationId);
    const commit = linksDb.getCommit(input.commitHash);

    if (!conversation && !commit) {
      return {
        success: false,
        message: `Neither conversation "${input.conversationId}" nor commit "${input.commitHash}" found in the links database. They may need to be captured by hooks first, or you can use the CLI to manually add them.`,
      };
    }

    // Determine matched files if not provided
    let matchedFiles = input.matchedFiles ?? [];
    if (matchedFiles.length === 0 && conversation && commit) {
      const convFiles = new Set([
        ...conversation.relevantFiles,
        ...conversation.capturedFiles,
      ]);
      matchedFiles = commit.changedFiles.filter(f =>
        convFiles.has(f) ||
        Array.from(convFiles).some(cf => cf.endsWith(f) || f.endsWith(cf))
      );
    }

    // Create the link
    linksDb.upsertLink({
      conversationId: input.conversationId,
      commitHash: input.commitHash,
      matchedFiles,
      confidence: input.confidence ?? 1.0,
      status: 'manual',
    });

    return {
      success: true,
      message: `Successfully linked conversation to commit ${input.commitHash.slice(0, 7)}`,
      link: {
        conversationId: input.conversationId,
        commitHash: input.commitHash,
        matchedFiles,
        confidence: input.confidence ?? 1.0,
        status: 'manual',
      },
    };
  } finally {
    linksDb.close();
  }
}
