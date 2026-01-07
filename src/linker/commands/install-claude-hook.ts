/**
 * Install Claude Code hook for capturing session events
 * Configures hooks in ~/.claude/settings.json
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import type { LinkCommandResult } from '../types.js';
import { CLAUDE_CODE_HOOK_SCRIPT } from './hook-scripts.js';

/**
 * Claude Code hook configuration structure (v2.0.76+ format)
 * Based on ~/.claude/settings.json schema
 * New format: { matcher: string, hooks: Array<{ type, command }> }
 */
type ClaudeHookCommand = {
  type: 'command' | 'prompt';
  command?: string;
  prompt?: string;
};

type ClaudeHookEntry = {
  matcher: string;
  hooks: ClaudeHookCommand[];
};

type ClaudeSettings = {
  hooks?: {
    PreToolUse?: ClaudeHookEntry[];
    PostToolUse?: ClaudeHookEntry[];
    Stop?: ClaudeHookEntry[];
    SubagentStop?: ClaudeHookEntry[];
    SessionStart?: ClaudeHookEntry[];
    SessionEnd?: ClaudeHookEntry[];
    UserPromptSubmit?: ClaudeHookEntry[];
    PreCompact?: ClaudeHookEntry[];
    Notification?: ClaudeHookEntry[];
    [key: string]: ClaudeHookEntry[] | undefined;
  };
  [key: string]: unknown;
};

export async function installClaudeHook(): Promise<LinkCommandResult> {
  try {
    const claudeDir = join(homedir(), '.claude');
    const hooksDir = join(claudeDir, 'hooks');
    const scriptPath = join(hooksDir, 'chat-history-link.sh');
    const settingsPath = join(claudeDir, 'settings.json');

    // Ensure hooks directory exists
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    // Write the hook script
    writeFileSync(scriptPath, CLAUDE_CODE_HOOK_SCRIPT, 'utf-8');
    chmodSync(scriptPath, '755');

    // Update settings.json
    let settings: ClaudeSettings = {};
    if (existsSync(settingsPath)) {
      try {
        const content = readFileSync(settingsPath, 'utf-8');
        settings = JSON.parse(content);
      } catch {
        // If parsing fails, start fresh
        settings = {};
      }
    }

    // Ensure hooks object exists
    if (!settings.hooks) {
      settings.hooks = {};
    }

    // Define our hook entries (v2.0.76+ format)
    const sessionEndEntry: ClaudeHookEntry = {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: `${scriptPath} SessionEnd`,
        },
      ],
    };

    const stopEntry: ClaudeHookEntry = {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: `${scriptPath} Stop`,
        },
      ],
    };

    // Helper to check if hook entry already exists
    const hasHookEntry = (entries: ClaudeHookEntry[] | undefined, command: string): boolean => {
      return entries?.some(e => e.hooks.some(h => h.command === command)) ?? false;
    };

    // SessionEnd hook - captures when a session ends
    if (!settings.hooks.SessionEnd) {
      settings.hooks.SessionEnd = [];
    }
    if (!hasHookEntry(settings.hooks.SessionEnd, sessionEndEntry.hooks[0].command!)) {
      settings.hooks.SessionEnd.push(sessionEndEntry);
    }

    // Stop hook - captures when agent stops
    if (!settings.hooks.Stop) {
      settings.hooks.Stop = [];
    }
    if (!hasHookEntry(settings.hooks.Stop, stopEntry.hooks[0].command!)) {
      settings.hooks.Stop.push(stopEntry);
    }

    // Write updated settings.json
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    return {
      success: true,
      message: `Claude Code hook installed successfully.
  Script: ${scriptPath}
  Config: ${settingsPath}

The hook will capture:
  - Session end events with conversation metadata
  - Agent stop events

Note: These hooks will work for future Claude Code sessions.`,
      data: {
        scriptPath,
        settingsPath,
        hooksConfig: settings.hooks,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to install Claude Code hook: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
