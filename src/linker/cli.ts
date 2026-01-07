#!/usr/bin/env node
/**
 * CLI entry point for the Conversation ↔ Git Linker feature
 * Handles subcommands: install-cursor-hook, install-git-hook, capture-hook, commit, link, list-conversation-links, get-commit-links
 */

import { installCursorHook } from './commands/install-cursor-hook.js';
import { installClaudeHook } from './commands/install-claude-hook.js';
import { installGitHook } from './commands/install-git-hook.js';
import { captureHook } from './commands/capture-hook.js';
import { recordCommit } from './commands/commit.js';
import { manualLink } from './commands/manual-link.js';
import { listConversationLinks, getCommitLinks } from './commands/query.js';
import type { LinkCommandResult, AgentName } from './types.js';

type SubCommand =
  | 'install-cursor-hook'
  | 'install-claude-hook'
  | 'install-git-hook'
  | 'capture-hook'
  | 'commit'
  | 'manual'
  | 'list-conversation-links'
  | 'get-commit-links'
  | 'help';

function parseArgs(args: string[]): { command: SubCommand; options: Record<string, string | boolean> } {
  const command = (args[0] ?? 'help') as SubCommand;
  const options: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        options[key] = nextArg;
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  return { command, options };
}

function printHelp(): void {
  console.log(`
cursor-chat-history-mcp link <command> [options]

Commands:
  install-cursor-hook    Install Cursor hook for capturing file edits and session end
  install-claude-hook    Install Claude Code hook for capturing session events
  install-git-hook       Install git post-commit hook for recording commits
    --repo <path>        Path to git repository (default: current directory)

  capture-hook           Process hook payload from stdin (called by hooks)
    --event <name>       Hook event type (afterFileEdit, stop, SessionEnd, Stop)
    --agent <name>       Agent name (cursor, claude-code)

  commit                 Record a git commit and auto-link to conversations
    --repo <path>        Path to git repository (default: current directory)
    --hash <hash>        Commit hash (default: HEAD)
    --branch <name>      Branch name (default: current branch)

  manual                 Manually link a conversation to a commit
    --conversation <id>  Conversation ID (required)
    --commit <hash>      Commit hash (required)
    --files <list>       Comma-separated list of matched files
    --confidence <num>   Confidence score 0-1 (default: 1.0)

  list-conversation-links  List commits linked to a conversation
    --conversation <id>  Conversation ID
    --workspace <path>   Filter by workspace path
    --file <path>        Filter by file path
    --limit <num>        Maximum results (default: 10)
    --json               Output as JSON

  get-commit-links       Get conversations linked to a commit
    --hash <hash>        Commit hash (required)
    --json               Output as JSON

  help                   Show this help message

Environment Variables:
  CURSOR_LINKS_DB_PATH   Override the links database path
  CURSOR_DB_PATH         Override the Cursor database path
`);
}

async function runCommand(command: SubCommand, options: Record<string, string | boolean>): Promise<LinkCommandResult> {
  switch (command) {
    case 'install-cursor-hook':
      return installCursorHook();

    case 'install-claude-hook':
      return installClaudeHook();

    case 'install-git-hook':
      return installGitHook({
        repoPath: typeof options.repo === 'string' ? options.repo : undefined,
      });

    case 'capture-hook':
      if (typeof options.event !== 'string') {
        return { success: false, message: 'Missing --event parameter' };
      }
      return captureHook({
        event: options.event as any,
        agent: (typeof options.agent === 'string' ? options.agent : 'cursor') as AgentName,
      });

    case 'commit':
      return recordCommit({
        repoPath: typeof options.repo === 'string' ? options.repo : undefined,
        hash: typeof options.hash === 'string' ? options.hash : undefined,
        branch: typeof options.branch === 'string' ? options.branch : undefined,
      });

    case 'manual':
      if (typeof options.conversation !== 'string') {
        return { success: false, message: 'Missing --conversation parameter' };
      }
      if (typeof options.commit !== 'string') {
        return { success: false, message: 'Missing --commit parameter' };
      }
      return manualLink({
        conversationId: options.conversation,
        commitHash: options.commit,
        files: typeof options.files === 'string' ? options.files.split(',') : undefined,
        confidence: typeof options.confidence === 'string' ? parseFloat(options.confidence) : undefined,
      });

    case 'list-conversation-links':
      return listConversationLinks({
        conversationId: typeof options.conversation === 'string' ? options.conversation : undefined,
        workspacePath: typeof options.workspace === 'string' ? options.workspace : undefined,
        filePath: typeof options.file === 'string' ? options.file : undefined,
        limit: typeof options.limit === 'string' ? parseInt(options.limit, 10) : undefined,
        json: !!options.json,
      });

    case 'get-commit-links':
      if (typeof options.hash !== 'string') {
        return { success: false, message: 'Missing --hash parameter' };
      }
      return getCommitLinks({
        commitHash: options.hash,
        json: !!options.json,
      });

    case 'help':
    default:
      printHelp();
      return { success: true, message: '' };
  }
}

/**
 * Main CLI entry point for linker commands
 */
export async function runLinkerCli(args: string[]): Promise<void> {
  const { command, options } = parseArgs(args);

  try {
    const result = await runCommand(command, options);

    if (result.message) {
      if (result.success) {
        console.log(result.message);
      } else {
        console.error('Error:', result.message);
        process.exitCode = 1;
      }
    }

    if (result.data && (options.json || command === 'list-conversation-links' || command === 'get-commit-links')) {
      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
      }
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
