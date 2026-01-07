/**
 * Windsurf conversation reader
 * Parses SQLite database similar to Cursor (state.vscdb)
 *
 * Storage locations:
 * - macOS: ~/Library/Application Support/Windsurf/User/globalStorage/state.vscdb
 * - Linux: ~/.config/Windsurf/User/globalStorage/state.vscdb
 * - Windows: %APPDATA%/Windsurf/User/globalStorage/state.vscdb
 */

import { homedir, platform } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import type { AgentConversation, AgentMessage } from './agent-types.js';
import { BaseAgentReader } from './base-agent-reader.js';

/**
 * Chat data keys used by Windsurf
 */
const WINDSURF_CHAT_KEYS = [
  'workbench.panel.aichat.view.aichat.chatdata',
  'aiChat.chatdata',
  'chat.data',
  'cascade.chatdata'
] as const;

/**
 * Windsurf chat data structure
 */
type WindsurfChatData = {
  tabs?: Array<{
    tabId?: string;
    chatTitle?: string;
    bubbles?: Array<{
      type: 'user' | 'assistant' | number;
      text?: string;
      rawText?: string;
      selections?: Array<{
        uri?: { fsPath?: string };
        text?: string;
        rawText?: string;
        range?: unknown;
      }>;
      suggestedDiffs?: unknown[];
    }>;
  }>;
};

/**
 * Windsurf agent/flow conversation structure
 */
type WindsurfAgentData = {
  name?: string;
  status?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  conversation?: Array<{
    type: number;
    role?: string;
    text?: string;
    context?: {
      selections?: Array<{
        uri?: { fsPath?: string };
        text?: string;
        rawText?: string;
      }>;
    };
    suggestedCodeBlocks?: unknown[];
    diffHistories?: unknown[];
  }>;
};

/**
 * Get Windsurf installation directories
 */
function getWindsurfPaths(): string[] {
  const home = homedir();
  const os = platform();
  const paths: string[] = [];
  const patterns = ['Windsurf', 'windsurf', '.windsurf'];

  if (os === 'darwin') {
    for (const pattern of patterns) {
      paths.push(join(home, 'Library/Application Support', pattern));
    }
  } else if (os === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData/Roaming');
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData/Local');
    for (const pattern of patterns) {
      paths.push(join(appData, pattern));
      paths.push(join(localAppData, pattern));
    }
  } else {
    for (const pattern of patterns) {
      paths.push(join(home, '.config', pattern));
      paths.push(join(home, '.local/share', pattern));
    }
  }

  return paths.filter(p => existsSync(p));
}

/**
 * Windsurf conversation reader
 */
export class WindsurfReader extends BaseAgentReader {
  readonly agentName = 'windsurf' as const;

  private readonly installDirs: string[];
  private db: Database.Database | null = null;

  constructor() {
    super();
    this.installDirs = getWindsurfPaths();
  }

  async isAvailable(): Promise<boolean> {
    return this.installDirs.length > 0 && this.getGlobalDbPath() !== null;
  }

  async getConversationIds(): Promise<string[]> {
    const ids: string[] = [];
    const db = this.connect();
    if (!db) return ids;

    try {
      this.collectChatIds(db, ids);
      this.collectAgentIds(db, ids);
    } catch (error) {
      this.logError('Failed to get conversation IDs', error);
    }

    return ids;
  }

  async getConversation(conversationId: string): Promise<AgentConversation | null> {
    const db = this.connect();
    if (!db) return null;

    try {
      const [, type, ...rest] = conversationId.split(':');
      const id = rest.join(':');

      if (type === 'chat') {
        return this.getChatConversation(db, id, conversationId);
      } else if (type === 'agent') {
        return this.getAgentConversation(db, id, conversationId);
      }

      return null;
    } catch (error) {
      this.logError(`Failed to get conversation ${conversationId}`, error);
      return null;
    }
  }

  /**
   * Override to filter by files matching project path
   */
  override async getConversationsByProject(projectPath: string): Promise<AgentConversation[]> {
    const ids = await this.getConversationIds();
    const conversations: AgentConversation[] = [];
    const projectLower = projectPath.toLowerCase();

    for (const id of ids) {
      const conversation = await this.getConversation(id);
      if (!conversation) continue;

      const matches = conversation.files.some(f =>
        f.toLowerCase().includes(projectLower)
      );

      if (matches) {
        conversations.push(conversation);
      }
    }

    return this.sortByUpdatedAt(conversations);
  }

  /**
   * Override to add project filtering
   */
  override async searchConversations(query: string, options?: {
    projectPath?: string;
    limit?: number;
  }): Promise<AgentConversation[]> {
    const limit = options?.limit ?? 20;
    const ids = await this.getConversationIds();
    const results: AgentConversation[] = [];
    const queryLower = query.toLowerCase();

    for (const id of ids) {
      if (results.length >= limit) break;

      const conversation = await this.getConversation(id);
      if (!conversation) continue;

      if (options?.projectPath) {
        const projectLower = options.projectPath.toLowerCase();
        const inProject = conversation.files.some(f =>
          f.toLowerCase().includes(projectLower)
        );
        if (!inProject) continue;
      }

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
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private getGlobalDbPath(): string | null {
    for (const installDir of this.installDirs) {
      const dbPath = join(installDir, 'User/globalStorage/state.vscdb');
      if (existsSync(dbPath)) {
        return dbPath;
      }
    }
    return null;
  }

  private connect(): Database.Database | null {
    if (this.db) return this.db;

    const dbPath = this.getGlobalDbPath();
    if (!dbPath) return null;

    try {
      this.db = new Database(dbPath, { readonly: true });
      return this.db;
    } catch (error) {
      this.logError('Failed to connect to database', error);
      return null;
    }
  }

  private collectChatIds(db: Database.Database, ids: string[]): void {
    for (const key of WINDSURF_CHAT_KEYS) {
      try {
        const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as { value: string } | undefined;
        if (!row) continue;

        const data: WindsurfChatData = JSON.parse(row.value);
        if (!data.tabs) continue;

        for (const tab of data.tabs) {
          if (tab.bubbles && tab.bubbles.length > 0) {
            const tabId = tab.tabId || `chat-${data.tabs.indexOf(tab)}`;
            ids.push(`windsurf:chat:${tabId}`);
          }
        }
      } catch (error) {
        this.logError(`Failed to parse chat key ${key}`, error);
      }
    }
  }

  private collectAgentIds(db: Database.Database, ids: string[]): void {
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      if (!tables.some(t => t.name === 'cursorDiskKV')) return;

      const rows = db.prepare(
        "SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%' OR key LIKE 'agentData:%' OR key LIKE 'flowData:%'"
      ).all() as { key: string }[];

      for (const row of rows) {
        ids.push(`windsurf:agent:${row.key}`);
      }
    } catch (error) {
      this.logError('Failed to collect agent IDs', error);
    }
  }

  private getChatConversation(
    db: Database.Database,
    tabId: string,
    conversationId: string
  ): AgentConversation | null {
    for (const key of WINDSURF_CHAT_KEYS) {
      try {
        const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as { value: string } | undefined;
        if (!row) continue;

        const data: WindsurfChatData = JSON.parse(row.value);
        if (!data.tabs) continue;

        const tab = data.tabs.find(t =>
          (t.tabId || `chat-${data.tabs!.indexOf(t)}`) === tabId
        );

        if (!tab || !tab.bubbles) continue;

        const messages: AgentMessage[] = [];
        const files = new Set<string>();
        let title = tab.chatTitle;

        for (const bubble of tab.bubbles) {
          const content = bubble.rawText || bubble.text || '';
          if (!content.trim()) continue;

          const role = bubble.type === 'user' || bubble.type === 1 ? 'user' : 'assistant';

          if (!title && role === 'user') {
            title = content.substring(0, 100);
          }

          if (bubble.selections) {
            for (const sel of bubble.selections) {
              if (sel.uri?.fsPath) {
                files.add(sel.uri.fsPath);
              }
            }
          }

          messages.push({
            id: `${tab.bubbles.indexOf(bubble)}`,
            role,
            content,
            files: bubble.selections?.filter(s => s.uri?.fsPath).map(s => s.uri!.fsPath!) || [],
          });
        }

        const now = new Date().toISOString();
        return {
          conversationId,
          agent: 'windsurf',
          title,
          messages,
          files: Array.from(files),
          createdAt: now,
          updatedAt: now,
          metadata: { source: 'windsurf-chat', tabId }
        };
      } catch (error) {
        this.logError(`Failed to parse chat key for tab ${tabId}`, error);
      }
    }

    return null;
  }

  private getAgentConversation(
    db: Database.Database,
    key: string,
    conversationId: string
  ): AgentConversation | null {
    try {
      const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(key) as { value: string } | undefined;
      if (!row) return null;

      const data: WindsurfAgentData = JSON.parse(row.value);
      if (!data.conversation) return null;

      const messages: AgentMessage[] = [];
      const files = new Set<string>();

      for (const bubble of data.conversation) {
        const content = bubble.text || '';
        if (!content.trim()) continue;

        const role = bubble.type === 1 || bubble.role === 'user' ? 'user' : 'assistant';

        if (bubble.context?.selections) {
          for (const sel of bubble.context.selections) {
            if (sel.uri?.fsPath) {
              files.add(sel.uri.fsPath);
            }
          }
        }

        messages.push({
          id: `${data.conversation.indexOf(bubble)}`,
          role,
          content,
        });
      }

      return {
        conversationId,
        agent: 'windsurf',
        title: data.name || 'Untitled',
        messages,
        files: Array.from(files),
        createdAt: data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: data.lastUpdatedAt ? new Date(data.lastUpdatedAt).toISOString() : new Date().toISOString(),
        metadata: {
          source: 'windsurf-agent',
          status: data.status,
        }
      };
    } catch (error) {
      this.logError(`Failed to parse agent conversation ${key}`, error);
      return null;
    }
  }
}
