/**
 * Claude Code-specific hook event handlers
 */

import { basename, resolve } from 'path';
import { LinksDatabase } from '../../links-database.js';
import { ClaudeCodeReader } from '../../../database/claude-code-reader.js';
import type { LinkCommandResult } from '../../types.js';

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
export async function handleClaudeCodeStop(
  linksDb: LinksDatabase,
  payload: Record<string, unknown>
): Promise<LinkCommandResult> {
  const claudePayload = payload as Partial<ClaudeCodeHookPayload>;

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
    } catch (err) {
      if (process.env.DEBUG_HOOK) {
        console.error('[claude-handler] Reader fallback triggered:', err instanceof Error ? err.message : err);
      }
    }

    return { success: true, message: 'No session_id or cwd in Claude Code payload' };
  }

  const conversationId = `claude-code:${sessionId ?? 'unknown'}`;
  const workspaceRoot = cwd ?? process.cwd();

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
    data: { conversationId, title, workspaceRoot },
  };
}
