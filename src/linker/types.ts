/**
 * Types for the Conversation ↔ Git Linker feature
 */

// Supported AI agents
export type AgentName = 'cursor' | 'claude-code' | 'codex' | 'aider' | 'continue';

// Database record types
export type ConversationRecord = {
  conversationId: string;
  agent: AgentName;
  workspaceRoot: string;
  projectName: string;
  title: string | null;
  summary: string | null;
  aiSummary: string | null;
  relevantFiles: string[];
  attachedFolders: string[];
  capturedFiles: string[];
  searchableText: string | null;
  createdAt: string;
  updatedAt: string;
  lastHookEvent: string | null;
};

export type CommitRecord = {
  commitHash: string;
  repoPath: string;
  branch: string;
  author: string;
  message: string;
  committedAt: string;
  changedFiles: string[];
  createdAt: string;
};

export type LinkRecord = {
  id: number;
  conversationId: string;
  commitHash: string;
  matchedFiles: string[];
  confidence: number;
  status: 'auto' | 'manual';
  createdAt: string;
};

// Hook event types
// Cursor events: afterFileEdit, stop, beforeSubmitPrompt
// Claude Code events: PreToolUse, PostToolUse, Stop, SubagentStop, SessionStart, SessionEnd, UserPromptSubmit, PreCompact, Notification
export type HookEventType =
  | 'afterFileEdit'
  | 'stop'
  | 'beforeSubmitPrompt'
  // Claude Code events
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'Notification';

// Cursor's actual hook payload format (uses snake_case)
export type CursorHookPayload = {
  // Common fields from all hooks
  conversation_id: string;
  generation_id: string;
  model: string;
  hook_event_name: string;
  cursor_version: string;
  workspace_roots: string[];
  user_email: string | null;

  // afterFileEdit specific
  file_path?: string;
  edits?: Array<{ old_string: string; new_string: string }>;

  // stop specific
  status?: 'completed' | 'aborted' | 'error';
  loop_count?: number;
};

// Legacy payload type (keeping for backwards compat)
export type HookPayload = {
  event: HookEventType;
  conversationId?: string;
  files?: string[];
  workspaceRoot?: string;
  timestamp?: string;
};

// CLI command types
export type LinkCommandResult = {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
};

// Auto-link scoring
export type AutoLinkScore = {
  conversationId: string;
  score: number;
  fileOverlap: number;
  recency: number;
  matchedFiles: string[];
};

// Query result types
export type ConversationCommitsResult = {
  conversation: ConversationRecord | null;
  commits: Array<{
    commit: CommitRecord;
    link: LinkRecord;
  }>;
};

export type CommitConversationsResult = {
  commit: CommitRecord | null;
  conversations: Array<{
    conversation: ConversationRecord;
    link: LinkRecord;
  }>;
};

export type KeywordMatch = {
  keyword: string;
  count: number;
  excerpts: string[];
};

export type FileContextResult = {
  filePath: string;
  conversations: Array<{
    conversation: ConversationRecord;
    relevance: 'direct' | 'indirect';
    keywordMatches?: KeywordMatch[];
  }>;
  commits: Array<{
    commit: CommitRecord;
    relevance: 'direct' | 'indirect';
  }>;
  guidance: string;
};
