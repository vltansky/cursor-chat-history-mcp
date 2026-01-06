/**
 * Process hook payloads from Cursor hooks
 * Handles afterFileEdit and stop events
 */

import { resolve, dirname, basename } from 'path';
import { existsSync, statSync } from 'fs';
import { LinksDatabase } from '../links-database.js';
import { CursorDatabaseReader } from '../../database/reader.js';
import { detectCursorDatabasePath } from '../../utils/database-utils.js';
import type { LinkCommandResult, HookEventType, HookPayload } from '../types.js';

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
}): Promise<LinkCommandResult> {
  const linksDb = new LinksDatabase();

  try {
    await linksDb.connect();

    // Read payload from stdin
    const stdinData = await readStdin();
    let payload: HookPayload = { event: options.event };

    if (stdinData.trim()) {
      try {
        payload = { ...JSON.parse(stdinData), event: options.event };
      } catch {
        // If parsing fails, continue with minimal payload
      }
    }

    switch (options.event) {
      case 'afterFileEdit':
        return handleAfterFileEdit(linksDb, payload);

      case 'stop':
        return handleStop(linksDb, payload);

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
 */
async function handleAfterFileEdit(
  linksDb: LinksDatabase,
  payload: HookPayload
): Promise<LinkCommandResult> {
  const files = payload.files ?? [];
  const workspaceRoot = payload.workspaceRoot;
  const conversationId = payload.conversationId;

  if (!conversationId || files.length === 0) {
    return {
      success: true,
      message: 'No files or conversation to capture',
    };
  }

  // Determine workspace root from files if not provided
  let effectiveWorkspace = workspaceRoot;
  if (!effectiveWorkspace && files.length > 0) {
    effectiveWorkspace = findRepoRoot(files[0]) ?? dirname(files[0]);
  }

  if (!effectiveWorkspace) {
    return {
      success: false,
      message: 'Could not determine workspace root',
    };
  }

  // Normalize file paths
  const normalizedFiles = files.map(f => normalizeFilePath(f, effectiveWorkspace!));

  // Upsert conversation with captured files
  linksDb.upsertConversation({
    conversationId,
    workspaceRoot: effectiveWorkspace,
    projectName: extractProjectName(effectiveWorkspace),
    title: null,
    summary: null,
    aiSummary: null,
    relevantFiles: [],
    attachedFolders: [],
    capturedFiles: normalizedFiles,
    searchableText: null,
    lastHookEvent: 'afterFileEdit',
  });

  return {
    success: true,
    message: `Captured ${normalizedFiles.length} file(s) for conversation ${conversationId}`,
    data: {
      conversationId,
      capturedFiles: normalizedFiles,
    },
  };
}

/**
 * Handle stop event - fetch conversation metadata and persist
 */
async function handleStop(
  linksDb: LinksDatabase,
  payload: HookPayload
): Promise<LinkCommandResult> {
  const conversationId = payload.conversationId;
  const workspaceRoot = payload.workspaceRoot;

  if (!conversationId) {
    return {
      success: true,
      message: 'No conversation ID provided',
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

  // Determine workspace root from attached folders if not provided
  let effectiveWorkspace = workspaceRoot;
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
