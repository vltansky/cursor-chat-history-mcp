/**
 * Manually create a link between a conversation and a commit
 */

import { LinksDatabase } from '../links-database.js';
import type { LinkCommandResult } from '../types.js';

export async function manualLink(options: {
  conversationId: string;
  commitHash: string;
  files?: string[];
  confidence?: number;
}): Promise<LinkCommandResult> {
  const linksDb = new LinksDatabase();

  try {
    await linksDb.connect();

    // Verify conversation exists
    const conversation = linksDb.getConversation(options.conversationId);

    // Verify commit exists
    const commit = linksDb.getCommit(options.commitHash);

    if (!conversation && !commit) {
      return {
        success: false,
        message: `Neither conversation ${options.conversationId} nor commit ${options.commitHash} found in links database. They may need to be captured by hooks first.`,
      };
    }

    // Determine matched files
    let matchedFiles = options.files ?? [];

    // If no files specified, try to find common files
    if (matchedFiles.length === 0 && conversation && commit) {
      const convFiles = new Set([
        ...conversation.relevantFiles,
        ...conversation.capturedFiles,
      ]);
      matchedFiles = commit.changedFiles.filter(f =>
        convFiles.has(f) || Array.from(convFiles).some(cf => cf.endsWith(f) || f.endsWith(cf))
      );
    }

    // Create the link
    linksDb.upsertLink({
      conversationId: options.conversationId,
      commitHash: options.commitHash,
      matchedFiles,
      confidence: options.confidence ?? 1.0,
      status: 'manual',
    });

    const shortHash = options.commitHash.slice(0, 7);
    return {
      success: true,
      message: `Linked conversation ${options.conversationId} to commit ${shortHash}`,
      data: {
        conversationId: options.conversationId,
        commitHash: options.commitHash,
        matchedFiles,
        confidence: options.confidence ?? 1.0,
        status: 'manual',
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create link: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    linksDb.close();
  }
}
