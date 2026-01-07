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
 * Claude Code hook configuration structure
 * Based on ~/.claude/settings.json schema
 */
type ClaudeHookType = 'command' | 'prompt';
type ClaudeHookMatcher = {
  tool_name?: string;
  [key: string]: unknown;
};

type ClaudeHook = {
  type: ClaudeHookType;
  command?: string;
  prompt?: string;
  matcher?: ClaudeHookMatcher;
};

type ClaudeSettings = {
  hooks?: {
    PreToolUse?: ClaudeHook[];
    PostToolUse?: ClaudeHook[];
    Stop?: ClaudeHook[];
    SubagentStop?: ClaudeHook[];
    SessionStart?: ClaudeHook[];
    SessionEnd?: ClaudeHook[];
    UserPromptSubmit?: ClaudeHook[];
    PreCompact?: ClaudeHook[];
    Notification?: ClaudeHook[];
    [key: string]: ClaudeHook[] | undefined;
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

    // Define our hook commands
    const sessionEndHook: ClaudeHook = {
      type: 'command',
      command: `${scriptPath} SessionEnd`,
    };

    const stopHook: ClaudeHook = {
      type: 'command',
      command: `${scriptPath} Stop`,
    };

    // Helper to check if hook already exists
    const hasHook = (hooks: ClaudeHook[] | undefined, command: string): boolean => {
      return hooks?.some(h => h.command === command) ?? false;
    };

    // SessionEnd hook - captures when a session ends
    if (!settings.hooks.SessionEnd) {
      settings.hooks.SessionEnd = [];
    }
    if (!hasHook(settings.hooks.SessionEnd, sessionEndHook.command!)) {
      settings.hooks.SessionEnd.push(sessionEndHook);
    }

    // Stop hook - captures when agent stops
    if (!settings.hooks.Stop) {
      settings.hooks.Stop = [];
    }
    if (!hasHook(settings.hooks.Stop, stopHook.command!)) {
      settings.hooks.Stop.push(stopHook);
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
