/**
 * Conversation ↔ Git Linker module
 *
 * This module bridges Cursor conversations and git commits via local hooks + CLI,
 * storing link metadata in a shared SQLite DB and exposing it through MCP tools.
 */

// Types
export * from './types.js';

// Database
export { LinksDatabase, getLinksDbPath } from './links-database.js';

// CLI
export { runLinkerCli } from './cli.js';

// MCP Tools
export {
  listConversationCommits,
  getCommitConversations,
  getFileContext,
  linkConversationCommit,
  listConversationCommitsSchema,
  getCommitConversationsSchema,
  getFileContextSchema,
  linkConversationCommitSchema,
} from './linker-tools.js';

// Commands (for direct use)
export { installCursorHook } from './commands/install-cursor-hook.js';
export { installGitHook } from './commands/install-git-hook.js';
export { captureHook } from './commands/capture-hook.js';
export { recordCommit } from './commands/commit.js';
export { manualLink } from './commands/manual-link.js';
export { listConversationLinks, getCommitLinks } from './commands/query.js';
