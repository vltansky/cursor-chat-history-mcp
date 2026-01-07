/**
 * Abstract base class for agent conversation readers
 * Provides common implementations for shared patterns across all readers
 */

import type { AgentConversation, AgentReader, AgentName } from './agent-types.js';

/**
 * Abstract base class for agent readers
 * Implements common patterns: getConversationsByProject, searchConversations
 * Subclasses only need to implement agent-specific methods
 */
export abstract class BaseAgentReader implements AgentReader {
  abstract readonly agentName: AgentName;

  /**
   * Check if this agent's data is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Get all conversation IDs, optionally filtered by project
   */
  abstract getConversationIds(projectPath?: string): Promise<string[]>;

  /**
   * Get a conversation by ID
   */
  abstract getConversation(conversationId: string): Promise<AgentConversation | null>;

  /**
   * Get conversations by project path
   * Default implementation: filter all conversations by project path in files
   */
  async getConversationsByProject(projectPath: string): Promise<AgentConversation[]> {
    const ids = await this.getConversationIds(projectPath);
    const conversations: AgentConversation[] = [];

    for (const id of ids) {
      const conversation = await this.getConversation(id);
      if (conversation) {
        conversations.push(conversation);
      }
    }

    return this.sortByUpdatedAt(conversations);
  }

  /**
   * Search conversations by content
   * Default implementation: linear scan with text matching
   */
  async searchConversations(query: string, options?: {
    projectPath?: string;
    limit?: number;
  }): Promise<AgentConversation[]> {
    const limit = options?.limit ?? 20;
    const ids = await this.getConversationIds(options?.projectPath);
    const results: AgentConversation[] = [];
    const queryLower = query.toLowerCase();

    for (const id of ids) {
      if (results.length >= limit) break;

      const conversation = await this.getConversation(id);
      if (!conversation) continue;

      const matches = conversation.messages.some(msg =>
        msg.content.toLowerCase().includes(queryLower)
      );

      if (matches) {
        results.push(conversation);
      }
    }

    return results;
  }

  /**
   * Sort conversations by updatedAt descending
   */
  protected sortByUpdatedAt(conversations: AgentConversation[]): AgentConversation[] {
    return conversations.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Log an error with agent context
   */
  protected logError(message: string, error: unknown): void {
    console.error(`[${this.agentName}] ${message}:`, error);
  }
}
