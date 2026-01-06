/**
 * Query commands for listing and getting links
 */

import { LinksDatabase } from '../links-database.js';
import type { LinkCommandResult } from '../types.js';

export async function listConversationLinks(options: {
  conversationId?: string;
  workspacePath?: string;
  filePath?: string;
  limit?: number;
  json?: boolean;
}): Promise<LinkCommandResult> {
  const linksDb = new LinksDatabase();

  try {
    await linksDb.connect();

    const limit = options.limit ?? 10;

    // If specific conversation ID provided
    if (options.conversationId) {
      const conversation = linksDb.getConversation(options.conversationId);
      if (!conversation) {
        return {
          success: false,
          message: `Conversation not found: ${options.conversationId}`,
        };
      }

      const links = linksDb.getLinksForConversation(options.conversationId);

      if (options.json) {
        return {
          success: true,
          message: '',
          data: { conversation, links },
        };
      }

      const lines = [
        `Conversation: ${conversation.conversationId}`,
        `  Title: ${conversation.title ?? '(untitled)'}`,
        `  Project: ${conversation.projectName}`,
        `  Workspace: ${conversation.workspaceRoot}`,
        `  Last Updated: ${conversation.updatedAt}`,
        '',
        `Linked Commits (${links.length}):`,
      ];

      for (const { link, commit } of links) {
        lines.push(`  ${commit.commitHash.slice(0, 7)} | ${commit.branch} | ${commit.message.slice(0, 50)}`);
        lines.push(`    Confidence: ${(link.confidence * 100).toFixed(0)}% (${link.status})`);
        if (link.matchedFiles.length > 0) {
          lines.push(`    Matched: ${link.matchedFiles.slice(0, 3).join(', ')}${link.matchedFiles.length > 3 ? '...' : ''}`);
        }
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: options.json ? { conversation, links } : undefined,
      };
    }

    // Find conversations by workspace or file
    const conversations = linksDb.findConversations({
      workspaceRoot: options.workspacePath,
      file: options.filePath,
      limit,
    });

    if (conversations.length === 0) {
      return {
        success: true,
        message: 'No matching conversations found',
        data: options.json ? { conversations: [] } : undefined,
      };
    }

    // Get links for each conversation
    const results = conversations.map(conv => ({
      conversation: conv,
      links: linksDb.getLinksForConversation(conv.conversationId),
    }));

    if (options.json) {
      return {
        success: true,
        message: '',
        data: { conversations: results },
      };
    }

    const lines = [`Found ${results.length} conversation(s):\n`];

    for (const { conversation, links } of results) {
      lines.push(`${conversation.conversationId}`);
      lines.push(`  Title: ${conversation.title ?? '(untitled)'}`);
      lines.push(`  Project: ${conversation.projectName}`);
      lines.push(`  Linked commits: ${links.length}`);
      lines.push('');
    }

    return {
      success: true,
      message: lines.join('\n'),
      data: options.json ? { conversations: results } : undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    linksDb.close();
  }
}

export async function getCommitLinks(options: {
  commitHash: string;
  json?: boolean;
}): Promise<LinkCommandResult> {
  const linksDb = new LinksDatabase();

  try {
    await linksDb.connect();

    const commit = linksDb.getCommit(options.commitHash);
    if (!commit) {
      return {
        success: false,
        message: `Commit not found: ${options.commitHash}`,
      };
    }

    const links = linksDb.getLinksForCommit(options.commitHash);

    if (options.json) {
      return {
        success: true,
        message: '',
        data: { commit, links },
      };
    }

    const lines = [
      `Commit: ${commit.commitHash}`,
      `  Branch: ${commit.branch}`,
      `  Author: ${commit.author}`,
      `  Message: ${commit.message}`,
      `  Date: ${commit.committedAt}`,
      `  Changed Files: ${commit.changedFiles.length}`,
      '',
      `Linked Conversations (${links.length}):`,
    ];

    for (const { link, conversation } of links) {
      lines.push(`  ${conversation.conversationId}`);
      lines.push(`    Title: ${conversation.title ?? '(untitled)'}`);
      lines.push(`    Project: ${conversation.projectName}`);
      lines.push(`    Confidence: ${(link.confidence * 100).toFixed(0)}% (${link.status})`);
      if (link.matchedFiles.length > 0) {
        lines.push(`    Matched: ${link.matchedFiles.slice(0, 3).join(', ')}${link.matchedFiles.length > 3 ? '...' : ''}`);
      }
    }

    return {
      success: true,
      message: lines.join('\n'),
      data: options.json ? { commit, links } : undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    linksDb.close();
  }
}
