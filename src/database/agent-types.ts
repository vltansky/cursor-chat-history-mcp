/**
 * Unified types for multi-agent conversation support
 * Abstracts away differences between Cursor, Claude Code, and other agents
 */

export type AgentName = 'cursor' | 'claude-code' | 'codex' | 'aider' | 'continue';

/**
 * Unified message structure across all agents
 */
export type AgentMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  codeBlocks?: Array<{
    language: string;
    code: string;
    filename?: string;
  }>;
  files?: string[];
  metadata?: Record<string, unknown>;
};

/**
 * Unified conversation structure across all agents
 */
export type AgentConversation = {
  conversationId: string;
  agent: AgentName;
  projectPath?: string;
  title?: string;
  messages: AgentMessage[];
  files: string[];
  folders?: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

/**
 * Reader interface that all agent readers must implement
 */
export interface AgentReader {
  readonly agentName: AgentName;

  /**
   * Check if this agent's data is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get all conversation IDs, optionally filtered by project
   */
  getConversationIds(projectPath?: string): Promise<string[]>;

  /**
   * Get a conversation by ID
   */
  getConversation(conversationId: string): Promise<AgentConversation | null>;

  /**
   * Get conversations by project path
   */
  getConversationsByProject(projectPath: string): Promise<AgentConversation[]>;

  /**
   * Search conversations by content
   */
  searchConversations(query: string, options?: {
    projectPath?: string;
    limit?: number;
  }): Promise<AgentConversation[]>;
}

/**
 * Filter options for multi-agent queries
 */
export type AgentFilters = {
  agents?: AgentName[];
  projectPath?: string;
  files?: string[];
  keywords?: string[];
  dateRange?: { start: string; end: string };
  limit?: number;
};

/**
 * Result from multi-agent search
 */
export type AgentSearchResult = {
  conversations: AgentConversation[];
  byAgent: Record<AgentName, number>;
  totalCount: number;
};
