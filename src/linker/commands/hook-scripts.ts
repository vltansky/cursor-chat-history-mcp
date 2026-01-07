/**
 * Shared hook script templates for Cursor and Claude Code
 */

/**
 * Generate a hook script that pipes stdin to the linker CLI
 * @param agentArg Optional agent argument (e.g., '--agent claude-code')
 */
export function generateHookScript(agentArg?: string): string {
  const agentFlag = agentArg ? ` ${agentArg}` : '';

  return `#!/bin/bash
# Chat History Linker Hook Script
# Pipes stdin directly to linker CLI

npx --yes cursor-chat-history-mcp-link capture-hook${agentFlag} 2>/dev/null || true
`;
}

/**
 * Script for Cursor hooks (default agent)
 */
export const CURSOR_HOOK_SCRIPT = generateHookScript();

/**
 * Script for Claude Code hooks
 */
export const CLAUDE_CODE_HOOK_SCRIPT = generateHookScript('--agent claude-code');
