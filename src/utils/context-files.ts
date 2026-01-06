/**
 * Context file management for conversation exports
 * Handles writing conversations to markdown files with LRU cache and TTL cleanup
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CONTEXT_DIR = join(homedir(), '.cursor-chat-history/context/conversations');
const MAX_FILES = 50;
const TTL_DAYS = 7;

/**
 * Ensure the context directory exists
 */
function ensureContextDir(): void {
  if (!existsSync(CONTEXT_DIR)) {
    mkdirSync(CONTEXT_DIR, { recursive: true });
  }
}

/**
 * Get the path for a conversation context file
 */
export function getContextFilePath(conversationId: string): string {
  return join(CONTEXT_DIR, `${conversationId}.md`);
}

/**
 * Stats returned when writing a conversation file
 */
export type ConversationFileStats = {
  messageCount: number;
  totalLines: number;
  fileSize: string;
  codeBlockCount: number;
};

/**
 * Write a conversation to a markdown file
 */
export function writeConversationFile(
  conversationId: string,
  data: {
    title?: string;
    createdAt?: string;
    updatedAt?: string;
    projectName?: string;
    relevantFiles?: string[];
    aiGeneratedSummary?: string;
    messages?: Array<{
      type: number;
      text: string;
      bubbleId?: string;
      codeBlocks?: Array<{ language: string; code: string; filename?: string }>;
    }>;
  }
): { filePath: string; stats: ConversationFileStats } {
  ensureContextDir();
  cleanupOldFiles();

  const filePath = getContextFilePath(conversationId);
  const lines: string[] = [];
  let codeBlockCount = 0;

  // Header
  lines.push(`# Conversation: ${data.title || 'Untitled'}`);
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| ID | ${conversationId} |`);
  if (data.createdAt) lines.push(`| Created | ${data.createdAt} |`);
  if (data.updatedAt) lines.push(`| Updated | ${data.updatedAt} |`);
  if (data.projectName) lines.push(`| Project | ${data.projectName} |`);
  if (data.relevantFiles?.length) {
    lines.push(`| Files | ${data.relevantFiles.slice(0, 10).join(', ')}${data.relevantFiles.length > 10 ? '...' : ''} |`);
  }
  lines.push('');

  // AI Summary if available
  if (data.aiGeneratedSummary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(data.aiGeneratedSummary);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Messages
  if (data.messages && data.messages.length > 0) {
    data.messages.forEach((msg, idx) => {
      const role = msg.type === 0 ? 'User' : 'Assistant';
      lines.push(`## Message ${idx + 1} (${role})`);
      lines.push('');
      lines.push(msg.text || '(empty)');
      lines.push('');

      // Include code blocks
      if (msg.codeBlocks && msg.codeBlocks.length > 0) {
        msg.codeBlocks.forEach(cb => {
          codeBlockCount++;
          const lang = cb.language || '';
          if (cb.filename) {
            lines.push(`**File: ${cb.filename}**`);
          }
          lines.push('```' + lang);
          lines.push(cb.code);
          lines.push('```');
          lines.push('');
        });
      }

      lines.push('---');
      lines.push('');
    });
  }

  const content = lines.join('\n');
  writeFileSync(filePath, content, 'utf-8');

  const stats: ConversationFileStats = {
    messageCount: data.messages?.length ?? 0,
    totalLines: lines.length,
    fileSize: formatBytes(Buffer.byteLength(content, 'utf-8')),
    codeBlockCount,
  };

  return { filePath, stats };
}

/**
 * Clean up old files using LRU + TTL strategy
 */
function cleanupOldFiles(): void {
  if (!existsSync(CONTEXT_DIR)) return;

  const files = readdirSync(CONTEXT_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fullPath = join(CONTEXT_DIR, f);
      const stat = statSync(fullPath);
      return {
        path: fullPath,
        name: f,
        mtime: stat.mtime,
        atime: stat.atime,
      };
    });

  const now = Date.now();
  const ttlMs = TTL_DAYS * 24 * 60 * 60 * 1000;

  // Delete files older than TTL
  for (const file of files) {
    if (now - file.mtime.getTime() > ttlMs) {
      try {
        unlinkSync(file.path);
      } catch {
        // Ignore deletion errors
      }
    }
  }

  // If still over limit, delete oldest files
  const remainingFiles = files.filter(f => existsSync(f.path));
  if (remainingFiles.length > MAX_FILES) {
    // Sort by modification time (oldest first)
    remainingFiles.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

    const toDelete = remainingFiles.length - MAX_FILES;
    for (let i = 0; i < toDelete; i++) {
      try {
        unlinkSync(remainingFiles[i].path);
      } catch {
        // Ignore deletion errors
      }
    }
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
