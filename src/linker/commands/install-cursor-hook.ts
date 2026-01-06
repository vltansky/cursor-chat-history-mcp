/**
 * Install Cursor hook for capturing file edits and session end
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import type { LinkCommandResult } from '../types.js';

const HOOK_SCRIPT = `#!/bin/bash
# Cursor Chat History Linker Hook Script
# Captures file edits and session end events

EVENT="$1"
shift

# Run the linker capture-hook command with the event
# Pass stdin (payload) to the command
npx --yes cursor-chat-history-mcp link capture-hook --event "$EVENT"
`;

type HooksConfig = {
  hooks?: {
    afterFileEdit?: string[];
    stop?: string[];
    [key: string]: string[] | undefined;
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
    writeFileSync(scriptPath, HOOK_SCRIPT, 'utf-8');
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

    // Ensure hooks object exists
    if (!hooksConfig.hooks) {
      hooksConfig.hooks = {};
    }

    // Add our script to afterFileEdit and stop hooks
    const scriptCommand = `${scriptPath} afterFileEdit`;
    const stopCommand = `${scriptPath} stop`;

    // afterFileEdit hook
    if (!hooksConfig.hooks.afterFileEdit) {
      hooksConfig.hooks.afterFileEdit = [];
    }
    if (!hooksConfig.hooks.afterFileEdit.includes(scriptCommand)) {
      hooksConfig.hooks.afterFileEdit.push(scriptCommand);
    }

    // stop hook
    if (!hooksConfig.hooks.stop) {
      hooksConfig.hooks.stop = [];
    }
    if (!hooksConfig.hooks.stop.includes(stopCommand)) {
      hooksConfig.hooks.stop.push(stopCommand);
    }

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
