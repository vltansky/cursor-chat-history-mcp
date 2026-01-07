/**
 * Cline/Roo/Kilo Code conversation reader
 * Parses JSON task files from VS Code globalStorage
 *
 * Storage locations:
 * - Cline: globalStorage/saoudrizwan.claude-dev/tasks/
 * - Roo Code: globalStorage/rooveterinaryinc.roo-cline/tasks/
 * - Kilo Code: globalStorage/kilocode.kilo-code/tasks/
 */

import { homedir, platform } from 'os';
import { join, basename } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import type { AgentConversation, AgentMessage, AgentName } from './agent-types.js';
import { BaseAgentReader } from './base-agent-reader.js';

/**
 * Cline task entry structure
 */
export type ClineTaskEntry = {
  ts: number;
  type: 'say' | 'ask';
  say?: 'text' | 'user_feedback' | 'user_feedback_diff' | 'api_req_started' |
        'api_req_finished' | 'error' | 'tool' | 'command_output' | 'completion_result' |
        'shell_integration_warning' | 'use_mcp_server' | 'mcp_server_request_started' |
        'mcp_server_response' | 'browser_action' | 'browser_action_result' |
        'command' | 'auto_approval_max_req_reached' | 'checkpoint_created' |
        'api_req_retried' | 'inspect_site_result';
  ask?: 'followup' | 'command' | 'completion_result' | 'tool' | 'api_req_failed' |
        'mistake_limit_reached' | 'browser_action_launch' | 'use_mcp_server' |
        'resume_task' | 'resume_completed_task' | 'new_task' | 'condense_context';
  text?: string;
  images?: string[];
  partial?: boolean;
};

/**
 * Cline API conversation item (from api_conversation_history.json)
 */
export type ClineApiConversation = {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'text' | 'image' | 'tool_use' | 'tool_result';
    text?: string;
    source?: { type: string; media_type: string; data: string };
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: unknown;
  }>;
};

/**
 * Extension IDs for Cline family
 */
const CLINE_EXTENSIONS: Record<ClineFamily, string> = {
  'cline': 'saoudrizwan.claude-dev',
  'roo-code': 'rooveterinaryinc.roo-cline',
  'kilo-code': 'kilocode.kilo-code',
};

type ClineFamily = 'cline' | 'roo-code' | 'kilo-code';

/**
 * Get VS Code/Cursor global storage directory
 */
function getVSCodeGlobalStorage(): string[] {
  const home = homedir();
  const os = platform();

  const paths: string[] = [];

  if (os === 'darwin') {
    paths.push(
      join(home, 'Library/Application Support/Code/User/globalStorage'),
      join(home, 'Library/Application Support/Code - Insiders/User/globalStorage'),
      join(home, 'Library/Application Support/Cursor/User/globalStorage'),
    );
  } else if (os === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData/Roaming');
    paths.push(
      join(appData, 'Code/User/globalStorage'),
      join(appData, 'Code - Insiders/User/globalStorage'),
      join(appData, 'Cursor/User/globalStorage'),
    );
  } else {
    paths.push(
      join(home, '.config/Code/User/globalStorage'),
      join(home, '.config/Code - Insiders/User/globalStorage'),
      join(home, '.config/Cursor/User/globalStorage'),
    );
  }

  return paths.filter(p => existsSync(p));
}

/**
 * Find Cline family tasks directories
 */
function findClineTasksDirs(variant: ClineFamily): string[] {
  const storageDirs = getVSCodeGlobalStorage();
  const extensionId = CLINE_EXTENSIONS[variant];
  const dirs: string[] = [];

  for (const storageDir of storageDirs) {
    const tasksDir = join(storageDir, extensionId, 'tasks');
    if (existsSync(tasksDir)) {
      dirs.push(tasksDir);
    }
  }

  return dirs;
}

/**
 * Cline/Roo/Kilo Code conversation reader
 */
export class ClineReader extends BaseAgentReader {
  readonly agentName: AgentName;
  private readonly variant: ClineFamily;
  private readonly tasksDirs: string[];

  constructor(variant: ClineFamily = 'cline') {
    super();
    this.variant = variant;
    // Map variant to AgentName (they match for cline family)
    this.agentName = variant as AgentName;
    this.tasksDirs = findClineTasksDirs(variant);
  }

  async isAvailable(): Promise<boolean> {
    return this.tasksDirs.length > 0;
  }

  async getConversationIds(projectPath?: string): Promise<string[]> {
    const ids: string[] = [];

    for (const tasksDir of this.tasksDirs) {
      let entries;
      try {
        entries = readdirSync(tasksDir, { withFileTypes: true });
      } catch (error) {
        this.logError(`Failed to read tasks directory ${tasksDir}`, error);
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const taskDir = join(tasksDir, entry.name);
          const uiMessagesPath = join(taskDir, 'ui_messages.json');

          if (existsSync(uiMessagesPath)) {
            if (projectPath && !this.matchesProject(taskDir, projectPath)) {
              continue;
            }
            ids.push(`${this.variant}:${entry.name}`);
          }
        }
      }
    }

    return ids;
  }

  async getConversation(conversationId: string): Promise<AgentConversation | null> {
    const id = conversationId.replace(new RegExp(`^${this.variant}:`), '');

    for (const tasksDir of this.tasksDirs) {
      const taskDir = join(tasksDir, id);
      const uiMessagesPath = join(taskDir, 'ui_messages.json');

      if (existsSync(uiMessagesPath)) {
        try {
          return this.parseTask(taskDir, conversationId);
        } catch (error) {
          this.logError(`Failed to parse task ${conversationId}`, error);
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Check if a task matches a project path
   */
  private matchesProject(taskDir: string, projectPath: string): boolean {
    const apiHistoryPath = join(taskDir, 'api_conversation_history.json');
    if (!existsSync(apiHistoryPath)) return false;

    try {
      const content = readFileSync(apiHistoryPath, 'utf-8');
      return content.toLowerCase().includes(projectPath.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * Parse a task directory into AgentConversation
   */
  private parseTask(taskDir: string, conversationId: string): AgentConversation {
    const uiMessagesPath = join(taskDir, 'ui_messages.json');
    const apiHistoryPath = join(taskDir, 'api_conversation_history.json');

    const uiContent = readFileSync(uiMessagesPath, 'utf-8');
    const uiMessages: ClineTaskEntry[] = JSON.parse(uiContent);

    let apiHistory: ClineApiConversation[] = [];
    if (existsSync(apiHistoryPath)) {
      try {
        const apiContent = readFileSync(apiHistoryPath, 'utf-8');
        apiHistory = JSON.parse(apiContent);
      } catch (error) {
        this.logError(`Failed to parse API history for ${conversationId}`, error);
      }
    }

    const messages: AgentMessage[] = [];
    const files = new Set<string>();
    let title: string | undefined;
    let createdAt: string | undefined;
    let updatedAt: string | undefined;

    for (const entry of uiMessages) {
      const timestamp = new Date(entry.ts).toISOString();
      if (!createdAt) createdAt = timestamp;
      updatedAt = timestamp;

      if (!entry.text && !entry.say && !entry.ask) continue;

      const role = entry.type === 'ask' ? 'user' : 'assistant';
      const content = entry.text || '';

      if (!content.trim() || entry.partial) continue;

      if (!title && role === 'user' && content.length > 0) {
        title = content.substring(0, 100);
      }

      messages.push({
        id: `${entry.ts}`,
        role,
        content,
        timestamp,
        metadata: {
          sayType: entry.say,
          askType: entry.ask,
        }
      });
    }

    this.extractFilesFromApiHistory(apiHistory, files);

    const stat = statSync(uiMessagesPath);

    return {
      conversationId,
      agent: this.agentName,
      title,
      messages,
      files: Array.from(files),
      createdAt: createdAt ?? stat.birthtime.toISOString(),
      updatedAt: updatedAt ?? stat.mtime.toISOString(),
      metadata: {
        taskId: basename(taskDir),
        variant: this.variant,
      }
    };
  }

  /**
   * Extract file references from API history
   */
  private extractFilesFromApiHistory(apiHistory: ClineApiConversation[], files: Set<string>): void {
    for (const msg of apiHistory) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.input) {
          const input = block.input as Record<string, unknown>;
          if (typeof input.path === 'string') files.add(input.path);
          if (typeof input.file_path === 'string') files.add(input.file_path);
          if (typeof input.filePath === 'string') files.add(input.filePath);
        }
        if (block.type === 'tool_result' && typeof block.content === 'string') {
          const pathMatches = block.content.match(/(?:\/[\w.-]+)+\.\w+/g);
          if (pathMatches) {
            for (const match of pathMatches) {
              if (match.length < 200) files.add(match);
            }
          }
        }
      }
    }
  }
}

/**
 * Create readers for all Cline family variants
 */
export function createClineFamilyReaders(): ClineReader[] {
  return (Object.keys(CLINE_EXTENSIONS) as ClineFamily[]).map(
    variant => new ClineReader(variant)
  );
}
