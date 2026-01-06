/**
 * Record git commit and run auto-link heuristic
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { LinksDatabase } from '../links-database.js';
import type { LinkCommandResult } from '../types.js';

/**
 * Execute a git command and return the output
 */
function git(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

export async function recordCommit(options: {
  repoPath?: string;
  hash?: string;
  branch?: string;
}): Promise<LinkCommandResult> {
  const linksDb = new LinksDatabase();

  try {
    const repoPath = resolve(options.repoPath ?? process.cwd());

    // Verify this is a git repository
    if (!existsSync(resolve(repoPath, '.git'))) {
      return {
        success: false,
        message: `Not a git repository: ${repoPath}`,
      };
    }

    // Get commit info
    const hash = options.hash ?? git('rev-parse HEAD', repoPath);
    if (!hash) {
      return {
        success: false,
        message: 'Could not determine commit hash',
      };
    }

    const branch = options.branch ?? git('rev-parse --abbrev-ref HEAD', repoPath);
    const author = git('log -1 --format="%an <%ae>"', repoPath);
    const message = git('log -1 --format="%s"', repoPath);
    const committedAt = git('log -1 --format="%aI"', repoPath);

    // Get changed files
    const changedFilesRaw = git('diff-tree --no-commit-id --name-only -r HEAD', repoPath);
    const changedFiles = changedFilesRaw ? changedFilesRaw.split('\n').filter(Boolean) : [];

    if (changedFiles.length === 0) {
      return {
        success: true,
        message: `Commit ${hash.slice(0, 7)} has no changed files, skipping`,
      };
    }

    await linksDb.connect();

    // Record the commit
    linksDb.upsertCommit({
      commitHash: hash,
      repoPath,
      branch,
      author,
      message,
      committedAt,
      changedFiles,
    });

    // Run auto-link heuristic
    const candidates = linksDb.findAutoLinkCandidates(hash, {
      windowDays: 14,
      minScore: 0.2,
    });

    let linksCreated = 0;
    for (const candidate of candidates) {
      linksDb.upsertLink({
        conversationId: candidate.conversationId,
        commitHash: hash,
        matchedFiles: candidate.matchedFiles,
        confidence: candidate.score,
        status: 'auto',
      });
      linksCreated++;
    }

    const shortHash = hash.slice(0, 7);
    const summary = linksCreated > 0
      ? `Commit ${shortHash} recorded and linked to ${linksCreated} conversation(s)`
      : `Commit ${shortHash} recorded (no matching conversations found)`;

    return {
      success: true,
      message: summary,
      data: {
        commitHash: hash,
        branch,
        changedFiles,
        linksCreated,
        candidates: candidates.map(c => ({
          conversationId: c.conversationId,
          score: c.score.toFixed(2),
          matchedFiles: c.matchedFiles,
        })),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to record commit: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    linksDb.close();
  }
}
