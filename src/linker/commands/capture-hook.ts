/**
 * Process hook payloads from Cursor and Claude Code hooks
 * Handles afterFileEdit, stop, SessionEnd, and Stop events
 */

import { resolve, dirname, basename } from 'path';
import { existsSync, statSync } from 'fs';
import { LinksDatabase } from '../links-database.js';
import { CursorDatabaseReader } from '../../database/reader.js';
import { ClaudeCodeReader } from '../../database/claude-code-reader.js';
import { detectCursorDatabasePath } from '../../utils/database-utils.js';
import type { LinkCommandResult, HookEventType, CursorHookPayload, AgentName } from '../types.js';

/**
 * Read JSON payload from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    // Set a timeout in case stdin is empty/not connected
    setTimeout(() => resolve(data), 100);
  });
}

/**
 * Find the git repository root for a file path
 */
function findRepoRoot(filePath: string): string | null {
  let current = filePath;

  // If it's a file, start from its directory
  try {
    if (existsSync(current) && statSync(current).isFile()) {
      current = dirname(current);
    }
  } catch {
    return null;
  }

  // Walk up the directory tree looking for .git
  while (current !== '/' && current !== '') {
    const gitPath = resolve(current, '.git');
    if (existsSync(gitPath)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Extract project name from workspace root
 */
function extractProjectName(workspaceRoot: string): string {
  return basename(workspaceRoot) || 'unknown';
}

/**
 * Normalize file path relative to workspace root
 */
function normalizeFilePath(filePath: string, workspaceRoot: string): string {
  const absPath = resolve(filePath);
  const absWorkspace = resolve(workspaceRoot);

  if (absPath.startsWith(absWorkspace)) {
    return absPath.slice(absWorkspace.length + 1);
  }
  return absPath;
}

export async function captureHook(options: {
  event: HookEventType;
  agent?: AgentName;
}): Promise<LinkCommandResult> {
  const linksDb = new LinksDatabase();
  const agent = options.agent ?? 'cursor';

  try {
    await linksDb.connect();

    // Read payload from stdin
    const stdinData = await readStdin();
    let payload: Record<string, unknown> = {};

    if (stdinData.trim()) {
      try {
        payload = JSON.parse(stdinData);
      } catch {
        // If parsing fails, continue with empty payload
      }
    }

    // Route to appropriate handler based on agent and event
    if (agent === 'claude-code') {
      switch (options.event) {
        case 'SessionEnd':
        case 'Stop':
          return handleClaudeCodeStop(linksDb, payload);

        default:
          return {
            success: true,
            message: `Ignored unknown Claude Code event: ${options.event}`,
          };
      }
    }

    // Cursor events (default)
    switch (options.event) {
      case 'afterFileEdit':
        return handleAfterFileEdit(linksDb, payload as Partial<CursorHookPayload>, agent);

      case 'stop':
        return handleStop(linksDb, payload as Partial<CursorHookPayload>, agent);

      default:
        return {
          success: true,
          message: `Ignored unknown event: ${options.event}`,
        };
    }
  } finally {
    linksDb.close();
  }
}

/**
 * Handle afterFileEdit event - capture file paths being edited
 * Cursor payload: { conversation_id, file_path, edits, workspace_roots, ... }
 */
async function handleAfterFileEdit(
  linksDb: LinksDatabase,
  payload: Partial<CursorHookPayload>,
  agent: 'cursor' | 'claude-code' | 'codex' | 'aider' | 'continue'
): Promise<LinkCommandResult> {
  const conversationId = payload.conversation_id;
  const filePath = payload.file_path;
  const workspaceRoots = payload.workspace_roots ?? [];

  if (!conversationId) {
    return {
      success: true,
      message: 'No conversation_id in payload',
    };
  }

  if (!filePath) {
    return {
      success: true,
      message: 'No file_path in payload',
    };
  }

  // Determine workspace root from payload or file path
  let effectiveWorkspace = workspaceRoots[0];
  if (!effectiveWorkspace) {
    effectiveWorkspace = findRepoRoot(filePath) ?? dirname(filePath);
  }

  if (!effectiveWorkspace) {
    return {
      success: false,
      message: 'Could not determine workspace root',
    };
  }

  // Normalize file path
  const normalizedFile = normalizeFilePath(filePath, effectiveWorkspace);

  // Upsert conversation with captured file
  linksDb.upsertConversation({
    conversationId,
    agent,
    workspaceRoot: effectiveWorkspace,
    projectName: extractProjectName(effectiveWorkspace),
    title: null,
    summary: null,
    aiSummary: null,
    relevantFiles: [],
    attachedFolders: [],
    capturedFiles: [normalizedFile],
    searchableText: null,
    lastHookEvent: 'afterFileEdit',
  });

  return {
    success: true,
    message: `Captured file ${normalizedFile} for conversation ${conversationId}`,
    data: {
      conversationId,
      capturedFile: normalizedFile,
    },
  };
}

/**
 * Handle stop event - fetch conversation metadata and persist
 * Cursor payload: { conversation_id, status, loop_count, workspace_roots, ... }
 */
async function handleStop(
  linksDb: LinksDatabase,
  payload: Partial<CursorHookPayload>,
  agent: 'cursor' | 'claude-code' | 'codex' | 'aider' | 'continue'
): Promise<LinkCommandResult> {
  const conversationId = payload.conversation_id;
  const workspaceRoots = payload.workspace_roots ?? [];

  if (!conversationId) {
    return {
      success: true,
      message: 'No conversation_id in payload',
    };
  }

  // Try to fetch conversation summary from Cursor database
  let title: string | null = null;
  let aiSummary: string | null = null;
  let relevantFiles: string[] = [];
  let attachedFolders: string[] = [];

  try {
    const dbPath = process.env.CURSOR_DB_PATH || detectCursorDatabasePath();
    const reader = new CursorDatabaseReader({ dbPath });

    try {
      await reader.connect();

      const summary = await reader.getConversationSummary(conversationId, {
        includeTitle: true,
        includeAIGeneratedSummary: true,
        includeFileList: true,
        includeAttachedFolders: true,
      });

      if (summary) {
        title = summary.title ?? null;
        aiSummary = summary.aiGeneratedSummary ?? null;
        relevantFiles = summary.relevantFiles ?? [];
        attachedFolders = summary.attachedFolders ?? [];
      }
    } finally {
      reader.close();
    }
  } catch {
    // Cursor database access failed, continue with partial data
  }

  // Determine workspace root from payload or attached folders
  let effectiveWorkspace = workspaceRoots[0];
  if (!effectiveWorkspace && attachedFolders.length > 0) {
    effectiveWorkspace = findRepoRoot(attachedFolders[0]) ?? attachedFolders[0];
  }
  if (!effectiveWorkspace && relevantFiles.length > 0) {
    effectiveWorkspace = findRepoRoot(relevantFiles[0]) ?? dirname(relevantFiles[0]);
  }
  if (!effectiveWorkspace) {
    effectiveWorkspace = process.cwd();
  }

  // Normalize file paths
  const normalizedRelevantFiles = relevantFiles.map(f => normalizeFilePath(f, effectiveWorkspace!));
  const normalizedAttachedFolders = attachedFolders.map(f => normalizeFilePath(f, effectiveWorkspace!));

  // Build searchable text from title, summary, and first message
  const searchableText = [title, aiSummary].filter(Boolean).join(' ');

  // Upsert conversation with full metadata
  linksDb.upsertConversation({
    conversationId,
    agent,
    workspaceRoot: effectiveWorkspace,
    projectName: extractProjectName(effectiveWorkspace),
    title,
    summary: null,
    aiSummary,
    relevantFiles: normalizedRelevantFiles,
    attachedFolders: normalizedAttachedFolders,
    capturedFiles: [], // Will be merged with existing
    searchableText: searchableText || null,
    lastHookEvent: 'stop',
  });

  return {
    success: true,
    message: `Captured session end for conversation ${conversationId}`,
    data: {
      conversationId,
      title,
      aiSummary: aiSummary?.substring(0, 100) + (aiSummary && aiSummary.length > 100 ? '...' : ''),
      relevantFiles: normalizedRelevantFiles.length,
      attachedFolders: normalizedAttachedFolders.length,
    },
  };
}

/**
 * Claude Code hook payload structure
 */
type ClaudeCodeHookPayload = {
  session_id?: string;
  cwd?: string;
  transcript?: Array<{
    type: 'user' | 'assistant';
    message: {
      content: string | Array<{ type: string; text?: string }>;
    };
  }>;
  [key: string]: unknown;
};

/**
 * Handle Claude Code SessionEnd/Stop events
 * Payload contains session_id, cwd, and transcript
 */
async function handleClaudeCodeStop(
  linksDb: LinksDatabase,
  payload: Record<string, unknown>
): Promise<LinkCommandResult> {
  const claudePayload = payload as Partial<ClaudeCodeHookPayload>;

  // Try to get session info from payload or read from files
  const sessionId = claudePayload.session_id;
  const cwd = claudePayload.cwd;

  if (!sessionId && !cwd) {
    // Try to find the most recent conversation from Claude Code reader
    try {
      const reader = new ClaudeCodeReader();
      if (await reader.isAvailable()) {
        const conversations = await reader.getConversationsByProject(process.cwd());
        if (conversations.length > 0) {
          const latest = conversations[0];
          linksDb.upsertConversation({
            conversationId: latest.conversationId,
            agent: 'claude-code',
            workspaceRoot: latest.projectPath ?? process.cwd(),
            projectName: extractProjectName(latest.projectPath ?? process.cwd()),
            title: latest.title ?? null,
            summary: null,
            aiSummary: null,
            relevantFiles: latest.files,
            attachedFolders: [],
            capturedFiles: [],
            searchableText: latest.messages.map(m => m.content).join(' ').substring(0, 10000),
            lastHookEvent: 'SessionEnd',
          });

          return {
            success: true,
            message: `Captured Claude Code session ${latest.conversationId}`,
            data: {
              conversationId: latest.conversationId,
              title: latest.title,
              messageCount: latest.messages.length,
              files: latest.files.length,
            },
          };
        }
      }
    } catch {
      // Reader failed, try fallback
    }

    return {
      success: true,
      message: 'No session_id or cwd in Claude Code payload',
    };
  }

  const conversationId = `claude-code:${sessionId ?? 'unknown'}`;
  const workspaceRoot = cwd ?? process.cwd();

  // Extract message content from transcript if available
  let searchableText = '';
  let title: string | null = null;
  const files: string[] = [];

  if (claudePayload.transcript && Array.isArray(claudePayload.transcript)) {
    for (const entry of claudePayload.transcript) {
      if (entry.type === 'user' && !title) {
        const content = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content
              .filter((b): b is { type: string; text: string } => b.type === 'text' && !!b.text)
              .map(b => b.text)
              .join('\n');
        if (content) {
          title = content.substring(0, 100);
        }
      }

      const content = typeof entry.message.content === 'string'
        ? entry.message.content
        : entry.message.content
            .filter((b): b is { type: string; text: string } => b.type === 'text' && !!b.text)
            .map(b => b.text)
            .join('\n');

      if (content) {
        searchableText += content + '\n';
      }
    }
  }

  // Normalize file paths
  const normalizedFiles = files.map(f => normalizeFilePath(f, workspaceRoot));

  linksDb.upsertConversation({
    conversationId,
    agent: 'claude-code',
    workspaceRoot,
    projectName: extractProjectName(workspaceRoot),
    title,
    summary: null,
    aiSummary: null,
    relevantFiles: normalizedFiles,
    attachedFolders: [],
    capturedFiles: [],
    searchableText: searchableText.substring(0, 10000) || null,
    lastHookEvent: 'SessionEnd',
  });

  return {
    success: true,
    message: `Captured Claude Code session end for ${conversationId}`,
    data: {
      conversationId,
      title,
      workspaceRoot,
    },
  };
}
