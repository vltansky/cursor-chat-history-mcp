/**
 * Generic agent conversation listing utilities
 * Reduces copy-paste patterns across agent integrations
 */

import { CursorDatabaseReader } from '../database/reader.js';
import { ClaudeCodeReader } from '../database/claude-code-reader.js';
import { ClineReader, createClineFamilyReaders } from '../database/cline-reader.js';
import { WindsurfReader } from '../database/windsurf-reader.js';
import { CopilotChatReader } from '../database/copilot-reader.js';
import type { AgentName, AgentConversation, AgentReader } from '../database/agent-types.js';
import { detectCursorDatabasePath } from '../utils/database-utils.js';

/**
 * Supported agent filters for list_conversations
 */
export type AgentFilter = 'cursor' | 'claude-code' | 'cline' | 'windsurf' | 'copilot-chat' | 'all';

/**
 * Agent loader configuration
 */
type AgentLoaderConfig = {
  name: AgentFilter;
  createReader: () => AgentReader | AgentReader[];
  isEnabled: (filter: AgentFilter) => boolean;
};

/**
 * Registry of all supported agents and their loaders
 */
const AGENT_LOADERS: AgentLoaderConfig[] = [
  {
    name: 'claude-code',
    createReader: () => new ClaudeCodeReader(),
    isEnabled: (filter) => filter === 'claude-code' || filter === 'all',
  },
  {
    name: 'cline',
    createReader: () => createClineFamilyReaders(),
    isEnabled: (filter) => filter === 'cline' || filter === 'all',
  },
  {
    name: 'windsurf',
    createReader: () => new WindsurfReader(),
    isEnabled: (filter) => filter === 'windsurf' || filter === 'all',
  },
  {
    name: 'copilot-chat',
    createReader: () => new CopilotChatReader(),
    isEnabled: (filter) => filter === 'copilot-chat' || filter === 'all',
  },
];

/**
 * Conversation output format matching ListConversationsOutput
 */
import type { QualityFactors } from '../utils/quality.js';

/**
 * Conversation output format matching ListConversationsOutput
 */
export type ConversationListItem = {
  composerId: string;
  agent: AgentName;
  format: 'legacy' | 'modern' | 'jsonl';
  messageCount: number;
  hasCodeBlocks: boolean;
  relevantFiles: string[];
  attachedFolders: string[];
  firstMessage?: string;
  title?: string;
  aiGeneratedSummary?: string;
  size: number;
  qualityScore?: number;
  qualityFactors?: QualityFactors;
};

/**
 * Result from listing conversations for an agent
 */
export type AgentListResult = {
  conversations: ConversationListItem[];
  totalFound: number;
};

/**
 * Options for listing conversations from agents
 */
export type AgentListOptions = {
  projectPath?: string;
  keywords?: string[];
  limit?: number;
};

/**
 * Convert AgentConversation to ConversationListItem format
 */
export function agentConvToListItem(conv: AgentConversation): ConversationListItem {
  const hasCodeBlocks = conv.messages.some(m => m.codeBlocks && m.codeBlocks.length > 0);
  return {
    composerId: conv.conversationId,
    agent: conv.agent,
    format: 'jsonl',
    messageCount: conv.messages.length,
    hasCodeBlocks,
    relevantFiles: conv.files,
    attachedFolders: conv.folders ?? [],
    firstMessage: conv.messages[0]?.content?.substring(0, 150),
    title: conv.title,
    aiGeneratedSummary: undefined,
    size: JSON.stringify(conv).length,
  };
}

/**
 * Filter conversations by keywords
 */
export function filterByKeywords(
  conversations: ConversationListItem[],
  keywords: string[] | undefined
): ConversationListItem[] {
  if (!keywords || keywords.length === 0) return conversations;

  return conversations.filter(conv => {
    const text = [conv.title, conv.firstMessage].filter(Boolean).join(' ').toLowerCase();
    return keywords.some(kw => text.includes(kw.toLowerCase()));
  });
}

/**
 * List conversations from a single AgentReader
 */
async function listFromReader(
  reader: AgentReader,
  options: AgentListOptions
): Promise<AgentListResult> {
  const conversations: ConversationListItem[] = [];

  try {
    if (!await reader.isAvailable()) {
      return { conversations: [], totalFound: 0 };
    }

    if (options.projectPath) {
      const convs = await reader.getConversationsByProject(options.projectPath);
      conversations.push(...convs.map(agentConvToListItem));
    } else {
      const convIds = await reader.getConversationIds();
      for (const convId of convIds.slice(0, options.limit ?? 10)) {
        const conv = await reader.getConversation(convId);
        if (conv) {
          conversations.push(agentConvToListItem(conv));
        }
      }
    }
  } catch (error) {
    console.error(`Failed to list ${reader.agentName} conversations:`, error);
  }

  return {
    conversations: filterByKeywords(conversations, options.keywords),
    totalFound: conversations.length,
  };
}

/**
 * List conversations from all enabled agents (excluding Cursor which has special handling)
 */
export async function listFromAllAgents(
  agentFilter: AgentFilter,
  options: AgentListOptions
): Promise<AgentListResult> {
  const allConversations: ConversationListItem[] = [];
  let totalFound = 0;

  for (const loader of AGENT_LOADERS) {
    if (!loader.isEnabled(agentFilter)) continue;

    const readers = loader.createReader();
    const readerArray = Array.isArray(readers) ? readers : [readers];

    for (const reader of readerArray) {
      try {
        const result = await listFromReader(reader, options);
        allConversations.push(...result.conversations);
        totalFound += result.totalFound;
      } finally {
        // Close reader if it has a close method
        if ('close' in reader && typeof reader.close === 'function') {
          reader.close();
        }
      }
    }
  }

  return { conversations: allConversations, totalFound };
}

/**
 * Check if an agent filter includes Cursor
 */
export function includesCursor(agentFilter: AgentFilter): boolean {
  return agentFilter === 'cursor' || agentFilter === 'all';
}

/**
 * Empty result for agent listing
 */
export const EMPTY_AGENT_RESULT: AgentListResult = {
  conversations: [],
  totalFound: 0,
};
