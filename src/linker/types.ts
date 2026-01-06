/**
 * Types for the Conversation ↔ Git Linker feature
 */

// Database record types
export type ConversationRecord = {
  conversationId: string;
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
export type HookEventType = 'afterFileEdit' | 'stop' | 'beforeSubmitPrompt';

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
