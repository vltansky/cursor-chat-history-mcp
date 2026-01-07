/**
 * GitHub Copilot Chat conversation reader
 * Parses JSON session files from VS Code workspaceStorage
 *
 * Storage location:
 * - workspaceStorage/[hash]/chatSessions/*.json
 */

import { homedir, platform } from 'os';
import { join, basename } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import type { AgentConversation, AgentMessage } from './agent-types.js';
import { BaseAgentReader } from './base-agent-reader.js';

/**
 * Copilot Chat session structure
 */
type CopilotChatSession = {
  requesterUsername?: string;
  requesterAvatarIconUri?: unknown;
  responderUsername?: string;
  responderAvatarIconUri?: unknown;
  providerRequestId?: string;
  requests: Array<{
    message: string | { text?: string };
    variableData?: unknown;
    response?: Array<{
      value: string | { value?: string };
    }>;
    result?: {
      errorDetails?: { message?: string };
    };
  }>;
};

/**
 * Get VS Code workspace storage directories
 */
function getWorkspaceStorageDirs(): string[] {
  const home = homedir();
  const os = platform();
  const paths: string[] = [];

  if (os === 'darwin') {
    paths.push(
      join(home, 'Library/Application Support/Code/User/workspaceStorage'),
      join(home, 'Library/Application Support/Code - Insiders/User/workspaceStorage'),
      join(home, 'Library/Application Support/Cursor/User/workspaceStorage'),
    );
  } else if (os === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData/Roaming');
    paths.push(
      join(appData, 'Code/User/workspaceStorage'),
      join(appData, 'Code - Insiders/User/workspaceStorage'),
      join(appData, 'Cursor/User/workspaceStorage'),
    );
  } else {
    paths.push(
      join(home, '.config/Code/User/workspaceStorage'),
      join(home, '.config/Code - Insiders/User/workspaceStorage'),
      join(home, '.config/Cursor/User/workspaceStorage'),
    );
  }

  return paths.filter(p => existsSync(p));
}

/**
 * Find all chat session directories
 */
function findChatSessionDirs(): Array<{ dir: string; workspaceId: string }> {
  const storageDirs = getWorkspaceStorageDirs();
  const results: Array<{ dir: string; workspaceId: string }> = [];

  for (const storageDir of storageDirs) {
    let workspaces;
    try {
      workspaces = readdirSync(storageDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue;

      const chatSessionsDir = join(storageDir, workspace.name, 'chatSessions');
      if (existsSync(chatSessionsDir)) {
        results.push({
          dir: chatSessionsDir,
          workspaceId: workspace.name,
        });
      }
    }
  }

  return results;
}

/**
 * GitHub Copilot Chat reader
 */
export class CopilotChatReader extends BaseAgentReader {
  readonly agentName = 'copilot-chat' as const;

  private readonly sessionDirs: Array<{ dir: string; workspaceId: string }>;

  constructor() {
    super();
    this.sessionDirs = findChatSessionDirs();
  }

  async isAvailable(): Promise<boolean> {
    return this.sessionDirs.length > 0;
  }

  async getConversationIds(projectPath?: string): Promise<string[]> {
    const ids: string[] = [];

    for (const { dir, workspaceId } of this.sessionDirs) {
      let files;
      try {
        files = readdirSync(dir).filter(f => f.endsWith('.json'));
      } catch (error) {
        this.logError(`Failed to read session directory ${dir}`, error);
        continue;
      }

      for (const file of files) {
        const sessionId = basename(file, '.json');

        if (projectPath && !this.matchesWorkspace(dir, projectPath)) {
          continue;
        }

        ids.push(`copilot-chat:${workspaceId}:${sessionId}`);
      }
    }

    return ids;
  }

  async getConversation(conversationId: string): Promise<AgentConversation | null> {
    const parts = conversationId.replace(/^copilot-chat:/, '').split(':');
    if (parts.length < 2) return null;

    const [workspaceId, ...sessionParts] = parts;
    const sessionId = sessionParts.join(':');

    for (const { dir, workspaceId: wId } of this.sessionDirs) {
      if (wId !== workspaceId) continue;

      const filePath = join(dir, `${sessionId}.json`);
      if (!existsSync(filePath)) continue;

      try {
        return this.parseSession(filePath, conversationId, dir);
      } catch (error) {
        this.logError(`Failed to parse session ${conversationId}`, error);
        return null;
      }
    }

    return null;
  }

  /**
   * Check if workspace matches project path
   */
  private matchesWorkspace(chatDir: string, projectPath: string): boolean {
    const workspaceJsonPath = join(chatDir, '..', 'workspace.json');
    if (!existsSync(workspaceJsonPath)) return false;

    try {
      const workspaceInfo = JSON.parse(readFileSync(workspaceJsonPath, 'utf-8'));
      const folder = workspaceInfo.folder;
      return folder && folder.toLowerCase().includes(projectPath.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * Parse a session file into AgentConversation
   */
  private parseSession(
    filePath: string,
    conversationId: string,
    chatDir: string
  ): AgentConversation {
    const content = readFileSync(filePath, 'utf-8');
    const session: CopilotChatSession = JSON.parse(content);

    const messages: AgentMessage[] = [];
    let title: string | undefined;

    const projectPath = this.getProjectPath(chatDir);

    for (let i = 0; i < session.requests.length; i++) {
      const request = session.requests[i];

      // Parse user message
      const userContent = typeof request.message === 'string'
        ? request.message
        : request.message?.text || '';

      if (userContent.trim()) {
        if (!title) {
          title = userContent.substring(0, 100);
        }

        messages.push({
          id: `user-${i}`,
          role: 'user',
          content: userContent,
        });
      }

      // Parse response
      if (request.response) {
        for (let j = 0; j < request.response.length; j++) {
          const resp = request.response[j];
          const assistantContent = typeof resp.value === 'string'
            ? resp.value
            : resp.value?.value || '';

          if (assistantContent.trim()) {
            messages.push({
              id: `assistant-${i}-${j}`,
              role: 'assistant',
              content: assistantContent,
            });
          }
        }
      }

      // Check for errors
      if (request.result?.errorDetails?.message) {
        messages.push({
          id: `error-${i}`,
          role: 'assistant',
          content: `Error: ${request.result.errorDetails.message}`,
          metadata: { isError: true },
        });
      }
    }

    const stat = statSync(filePath);

    return {
      conversationId,
      agent: 'copilot-chat',
      projectPath,
      title,
      messages,
      files: [],
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      metadata: {
        requesterUsername: session.requesterUsername,
        responderUsername: session.responderUsername,
      }
    };
  }

  /**
   * Get project path from workspace.json
   */
  private getProjectPath(chatDir: string): string | undefined {
    const workspaceJsonPath = join(chatDir, '..', 'workspace.json');
    if (!existsSync(workspaceJsonPath)) return undefined;

    try {
      const workspaceInfo = JSON.parse(readFileSync(workspaceJsonPath, 'utf-8'));
      return workspaceInfo.folder;
    } catch {
      return undefined;
    }
  }
}
