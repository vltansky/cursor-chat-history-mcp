/**
 * Claude Code conversation reader
 * Parses JSONL files from ~/.claude/projects/{escaped-path}/*.jsonl
 */

import { homedir } from 'os';
import { join, basename, dirname } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import type { AgentConversation, AgentMessage, AgentReader } from './agent-types.js';

/**
 * Claude Code JSONL entry structure (parsed from actual files)
 */
export type ClaudeCodeEntry = {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: 'external' | 'internal';
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch?: string;
  agentId?: string;
  type: 'user' | 'assistant';
  message: {
    role: 'user' | 'assistant';
    content: string | ClaudeContentBlock[];
    model?: string;
    id?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  uuid: string;
  timestamp: string;
  // Tool use entries
  toolName?: string;
  toolParameters?: Record<string, unknown>;
  toolResult?: unknown;
};

type ClaudeContentBlock = {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
};

/**
 * Get the Claude Code projects directory
 */
export function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Escape a path for Claude Code directory naming
 * Claude uses `-` instead of `/` for path components
 */
export function escapeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

/**
 * Unescape a Claude Code directory name to get the project path
 */
export function unescapeProjectPath(escapedPath: string): string {
  // The first `-` is the leading slash
  if (escapedPath.startsWith('-')) {
    return escapedPath.replace(/-/g, '/');
  }
  return escapedPath.replace(/-/g, '/');
}

/**
 * Claude Code conversation reader
 */
export class ClaudeCodeReader implements AgentReader {
  readonly agentName = 'claude-code';

  private projectsDir: string;

  constructor(projectsDir?: string) {
    this.projectsDir = projectsDir ?? getClaudeProjectsDir();
  }

  /**
   * Check if Claude Code data exists
   */
  async isAvailable(): Promise<boolean> {
    return existsSync(this.projectsDir);
  }

  /**
   * List all project directories
   */
  async listProjects(): Promise<string[]> {
    if (!existsSync(this.projectsDir)) return [];

    const entries = readdirSync(this.projectsDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => unescapeProjectPath(e.name));
  }

  /**
   * Get conversation IDs for a project
   */
  async getConversationIds(projectPath?: string): Promise<string[]> {
    if (!existsSync(this.projectsDir)) return [];

    const ids: string[] = [];

    if (projectPath) {
      const escapedPath = escapeProjectPath(projectPath);
      const projectDir = join(this.projectsDir, escapedPath);
      if (existsSync(projectDir)) {
        const files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
        for (const file of files) {
          // Use filename without extension as conversation ID, prefixed with agent name
          ids.push(`claude-code:${basename(file, '.jsonl')}`);
        }
      }
    } else {
      // Get from all projects
      const entries = readdirSync(this.projectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectDir = join(this.projectsDir, entry.name);
          const files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
          for (const file of files) {
            ids.push(`claude-code:${basename(file, '.jsonl')}`);
          }
        }
      }
    }

    return ids;
  }

  /**
   * Parse a conversation ID to get project path and session ID
   */
  private parseConversationId(conversationId: string): { projectPath: string; sessionId: string } | null {
    // Remove agent prefix if present
    const id = conversationId.replace(/^claude-code:/, '');

    // Search for the JSONL file in all project directories
    const entries = readdirSync(this.projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectDir = join(this.projectsDir, entry.name);
        const files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
        for (const file of files) {
          const sessionId = basename(file, '.jsonl');
          if (sessionId === id) {
            return {
              projectPath: unescapeProjectPath(entry.name),
              sessionId
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId: string): Promise<AgentConversation | null> {
    const parsed = this.parseConversationId(conversationId);
    if (!parsed) return null;

    const escapedPath = escapeProjectPath(parsed.projectPath);
    const filePath = join(this.projectsDir, escapedPath, `${parsed.sessionId}.jsonl`);

    if (!existsSync(filePath)) return null;

    try {
      const entries = this.parseJsonlFile(filePath);
      return this.entriesToConversation(entries, conversationId, parsed.projectPath, filePath);
    } catch (error) {
      console.error(`Failed to parse Claude Code conversation ${conversationId}:`, error);
      return null;
    }
  }

  /**
   * Parse a JSONL file into entries
   */
  private parseJsonlFile(filePath: string): ClaudeCodeEntry[] {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const entries: ClaudeCodeEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ClaudeCodeEntry;
        entries.push(entry);
      } catch (error) {
        // Skip malformed lines
        console.warn(`Skipping malformed JSONL line in ${filePath}`);
      }
    }

    return entries;
  }

  /**
   * Convert JSONL entries to AgentConversation
   */
  private entriesToConversation(
    entries: ClaudeCodeEntry[],
    conversationId: string,
    projectPath: string,
    filePath: string
  ): AgentConversation {
    const messages: AgentMessage[] = [];
    const files = new Set<string>();
    let title: string | undefined;
    let createdAt: string | undefined;
    let updatedAt: string | undefined;

    for (const entry of entries) {
      if (!createdAt) createdAt = entry.timestamp;
      updatedAt = entry.timestamp;

      // Extract message content
      let content = '';
      if (typeof entry.message.content === 'string') {
        content = entry.message.content;
      } else if (Array.isArray(entry.message.content)) {
        content = entry.message.content
          .filter((block): block is ClaudeContentBlock & { text: string } =>
            block.type === 'text' && typeof block.text === 'string'
          )
          .map(block => block.text)
          .join('\n');
      }

      // Skip empty messages
      if (!content.trim()) continue;

      // Use first user message as title
      if (!title && entry.type === 'user' && content.length > 0) {
        title = content.substring(0, 100);
      }

      // Extract file references from tool use
      if (Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block.type === 'tool_use' && block.input) {
            // Common tool patterns that reference files
            const input = block.input as Record<string, unknown>;
            if (typeof input.path === 'string') files.add(input.path);
            if (typeof input.file === 'string') files.add(input.file);
            if (typeof input.file_path === 'string') files.add(input.file_path);
            if (typeof input.filePath === 'string') files.add(input.filePath);
          }
        }
      }

      messages.push({
        id: entry.uuid,
        role: entry.type === 'user' ? 'user' : 'assistant',
        content,
        timestamp: entry.timestamp,
        metadata: {
          model: entry.message.model,
          cwd: entry.cwd,
          gitBranch: entry.gitBranch,
          agentId: entry.agentId,
        }
      });
    }

    // Get file stats
    const stat = statSync(filePath);

    return {
      conversationId,
      agent: 'claude-code',
      projectPath,
      title,
      messages,
      files: Array.from(files),
      createdAt: createdAt ?? stat.birthtime.toISOString(),
      updatedAt: updatedAt ?? stat.mtime.toISOString(),
      metadata: {
        sessionId: entries[0]?.sessionId,
        version: entries[0]?.version,
        gitBranch: entries[0]?.gitBranch,
      }
    };
  }

  /**
   * Get conversations by project path
   */
  async getConversationsByProject(projectPath: string): Promise<AgentConversation[]> {
    const escapedPath = escapeProjectPath(projectPath);
    const projectDir = join(this.projectsDir, escapedPath);

    if (!existsSync(projectDir)) return [];

    const conversations: AgentConversation[] = [];
    const files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const sessionId = basename(file, '.jsonl');
      const conversationId = `claude-code:${sessionId}`;
      const conversation = await this.getConversation(conversationId);
      if (conversation) {
        conversations.push(conversation);
      }
    }

    // Sort by updatedAt descending
    conversations.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return conversations;
  }

  /**
   * Search conversations by content
   */
  async searchConversations(query: string, options?: {
    projectPath?: string;
    limit?: number;
  }): Promise<AgentConversation[]> {
    const limit = options?.limit ?? 20;
    const results: AgentConversation[] = [];

    let projectDirs: string[];

    if (options?.projectPath) {
      const escapedPath = escapeProjectPath(options.projectPath);
      projectDirs = [join(this.projectsDir, escapedPath)];
    } else {
      const entries = readdirSync(this.projectsDir, { withFileTypes: true });
      projectDirs = entries
        .filter(e => e.isDirectory())
        .map(e => join(this.projectsDir, e.name));
    }

    const queryLower = query.toLowerCase();

    for (const projectDir of projectDirs) {
      if (!existsSync(projectDir)) continue;

      const files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        if (results.length >= limit) break;

        const filePath = join(projectDir, file);
        const content = readFileSync(filePath, 'utf-8');

        if (content.toLowerCase().includes(queryLower)) {
          const sessionId = basename(file, '.jsonl');
          const conversationId = `claude-code:${sessionId}`;
          const conversation = await this.getConversation(conversationId);
          if (conversation) {
            results.push(conversation);
          }
        }
      }
    }

    return results;
  }
}
