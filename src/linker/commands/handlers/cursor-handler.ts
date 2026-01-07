/**
 * Cursor-specific hook event handlers
 */

import { resolve, dirname, basename } from 'path';
import { existsSync, statSync } from 'fs';
import { LinksDatabase } from '../../links-database.js';
import { CursorDatabaseReader } from '../../../database/reader.js';
import { detectCursorDatabasePath } from '../../../utils/database-utils.js';
import type { LinkCommandResult, CursorHookPayload, AgentName } from '../../types.js';

/**
 * Find the git repository root for a file path
 */
function findRepoRoot(filePath: string): string | null {
  let current = filePath;

  try {
    if (existsSync(current) && statSync(current).isFile()) {
      current = dirname(current);
    }
  } catch {
    return null;
  }

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

/**
 * Handle afterFileEdit event - capture file paths being edited
 * Cursor payload: { conversation_id, file_path, edits, workspace_roots, ... }
 */
export async function handleAfterFileEdit(
  linksDb: LinksDatabase,
  payload: Partial<CursorHookPayload>,
  agent: AgentName
): Promise<LinkCommandResult> {
  const conversationId = payload.conversation_id;
  const filePath = payload.file_path;
  const workspaceRoots = payload.workspace_roots ?? [];

  if (!conversationId) {
    return { success: true, message: 'No conversation_id in payload' };
  }

  if (!filePath) {
    return { success: true, message: 'No file_path in payload' };
  }

  let effectiveWorkspace = workspaceRoots[0];
  if (!effectiveWorkspace) {
    effectiveWorkspace = findRepoRoot(filePath) ?? dirname(filePath);
  }

  if (!effectiveWorkspace) {
    return { success: false, message: 'Could not determine workspace root' };
  }

  const normalizedFile = normalizeFilePath(filePath, effectiveWorkspace);

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
    data: { conversationId, capturedFile: normalizedFile },
  };
}

/**
 * Handle stop event - fetch conversation metadata and persist
 * Cursor payload: { conversation_id, status, loop_count, workspace_roots, ... }
 */
export async function handleStop(
  linksDb: LinksDatabase,
  payload: Partial<CursorHookPayload>,
  agent: AgentName
): Promise<LinkCommandResult> {
  const conversationId = payload.conversation_id;
  const workspaceRoots = payload.workspace_roots ?? [];

  if (!conversationId) {
    return { success: true, message: 'No conversation_id in payload' };
  }

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
  } catch (err) {
    if (process.env.DEBUG_HOOK) {
      console.error('[cursor-handler] DB access failed:', err instanceof Error ? err.message : err);
    }
  }

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

  const normalizedRelevantFiles = relevantFiles.map(f => normalizeFilePath(f, effectiveWorkspace!));
  const normalizedAttachedFolders = attachedFolders.map(f => normalizeFilePath(f, effectiveWorkspace!));
  const searchableText = [title, aiSummary].filter(Boolean).join(' ');

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
    capturedFiles: [],
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
