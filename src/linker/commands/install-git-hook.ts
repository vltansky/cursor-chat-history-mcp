/**
 * Install git post-commit hook for recording commits
 */

import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import type { LinkCommandResult } from '../types.js';

const HOOK_MARKER = '# cursor-chat-history-linker';

const HOOK_SNIPPET = `
${HOOK_MARKER}
# Record commit for Cursor Chat History Linker
(npx --yes cursor-chat-history-mcp-link commit --repo "$PWD" &) 2>/dev/null
${HOOK_MARKER}-end
`;

export async function installGitHook(options: {
  repoPath?: string;
}): Promise<LinkCommandResult> {
  try {
    const repoPath = resolve(options.repoPath ?? process.cwd());
    const gitDir = join(repoPath, '.git');
    const hooksDir = join(gitDir, 'hooks');
    const postCommitPath = join(hooksDir, 'post-commit');

    // Verify this is a git repository
    if (!existsSync(gitDir)) {
      return {
        success: false,
        message: `Not a git repository: ${repoPath}`,
      };
    }

    // Ensure hooks directory exists
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    // Read existing post-commit hook if it exists
    let existingContent = '';
    let needsShebang = true;

    if (existsSync(postCommitPath)) {
      existingContent = readFileSync(postCommitPath, 'utf-8');

      // Check if our hook is already installed
      if (existingContent.includes(HOOK_MARKER)) {
        return {
          success: true,
          message: `Git hook already installed in: ${postCommitPath}`,
          data: { postCommitPath, alreadyInstalled: true },
        };
      }

      // Check if it already has a shebang
      if (existingContent.startsWith('#!')) {
        needsShebang = false;
      }
    }

    // Build the new hook content
    let newContent = existingContent;

    if (needsShebang) {
      newContent = '#!/bin/bash\n' + newContent;
    }

    // Append our hook snippet
    newContent = newContent.trimEnd() + '\n' + HOOK_SNIPPET;

    // Write the updated hook
    writeFileSync(postCommitPath, newContent, 'utf-8');
    chmodSync(postCommitPath, '755');

    return {
      success: true,
      message: `Git post-commit hook installed in: ${postCommitPath}

The hook will automatically record commits and link them to recent Cursor conversations.

Note: The hook runs asynchronously to avoid slowing down commits.`,
      data: {
        postCommitPath,
        repoPath,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to install git hook: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
