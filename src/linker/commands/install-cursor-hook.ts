/**
 * Install Cursor hook for capturing file edits and session end
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import type { LinkCommandResult } from '../types.js';
import { CURSOR_HOOK_SCRIPT } from './hook-scripts.js';

type HookEntry = { command: string };

type HooksConfig = {
  version?: number;
  hooks?: {
    afterFileEdit?: HookEntry[];
    stop?: HookEntry[];
    [key: string]: HookEntry[] | undefined;
  };
};

export async function installCursorHook(): Promise<LinkCommandResult> {
  try {
    const cursorDir = join(homedir(), '.cursor');
    const hooksDir = join(cursorDir, 'hooks');
    const scriptPath = join(hooksDir, 'cursor-history-link.sh');
    const hooksJsonPath = join(cursorDir, 'hooks.json');

    // Ensure hooks directory exists
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    // Write the hook script
    writeFileSync(scriptPath, CURSOR_HOOK_SCRIPT, 'utf-8');
    chmodSync(scriptPath, '755');

    // Update hooks.json
    let hooksConfig: HooksConfig = {};
    if (existsSync(hooksJsonPath)) {
      try {
        const content = readFileSync(hooksJsonPath, 'utf-8');
        hooksConfig = JSON.parse(content);
      } catch {
        // If parsing fails, start fresh
        hooksConfig = {};
      }
    }

    // Ensure config structure
    if (!hooksConfig.version) {
      hooksConfig.version = 1;
    }
    if (!hooksConfig.hooks) {
      hooksConfig.hooks = {};
    }

    // Hook entry format per Cursor docs
    const hookEntry: HookEntry = { command: scriptPath };

    // Helper to clean up old entries (string format or pointing to our script)
    const cleanOldEntries = (arr: unknown[] | undefined): HookEntry[] => {
      if (!arr) return [];
      return arr.filter((entry): entry is HookEntry => {
        // Skip string entries (old format)
        if (typeof entry === 'string') {
          return !entry.includes('cursor-history-link.sh');
        }
        // Skip object entries pointing to our script
        if (typeof entry === 'object' && entry && 'command' in entry) {
          return !(entry as HookEntry).command.includes('cursor-history-link.sh');
        }
        return true;
      });
    };

    // Clean and register afterFileEdit hook
    hooksConfig.hooks.afterFileEdit = cleanOldEntries(hooksConfig.hooks.afterFileEdit);
    hooksConfig.hooks.afterFileEdit.push(hookEntry);

    // Clean and register stop hook
    hooksConfig.hooks.stop = cleanOldEntries(hooksConfig.hooks.stop);
    hooksConfig.hooks.stop.push(hookEntry);

    // Write updated hooks.json
    writeFileSync(hooksJsonPath, JSON.stringify(hooksConfig, null, 2), 'utf-8');

    return {
      success: true,
      message: `Cursor hook installed successfully.
  Script: ${scriptPath}
  Config: ${hooksJsonPath}

The hook will capture:
  - File edits during Cursor sessions
  - Session end events with conversation metadata

Note: You may need to restart Cursor for hooks to take effect.`,
      data: {
        scriptPath,
        hooksJsonPath,
        hooksConfig,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to install Cursor hook: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
