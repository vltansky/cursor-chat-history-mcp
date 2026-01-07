/**
 * Process hook payloads from Cursor and Claude Code hooks
 * Routes events to appropriate agent-specific handlers
 */

import { readFileSync } from 'fs';
import { LinksDatabase } from '../links-database.js';
import { handleAfterFileEdit, handleStop, handleClaudeCodeStop } from './handlers/index.js';
import type { LinkCommandResult, HookEventType, CursorHookPayload, AgentName } from '../types.js';

/**
 * Read JSON payload from stdin (synchronous for reliability)
 */
function readStdin(): string {
  if (process.stdin.isTTY) {
    return '';
  }

  try {
    return readFileSync(0, 'utf-8');
  } catch (err) {
    if (process.env.DEBUG_HOOK) {
      console.error('[capture-hook] stdin read failed:', err instanceof Error ? err.message : err);
    }
    return '';
  }
}

/**
 * Parse JSON payload with debug logging on failure
 */
function parsePayload(stdinData: string): Record<string, unknown> {
  if (!stdinData.trim()) {
    return {};
  }

  try {
    return JSON.parse(stdinData);
  } catch (err) {
    if (process.env.DEBUG_HOOK) {
      console.error('[capture-hook] JSON parse failed:', err instanceof Error ? err.message : err);
    }
    return {};
  }
}

/**
 * Main entry point for hook event processing
 */
export async function captureHook(options: {
  event?: HookEventType;
  agent?: AgentName;
}): Promise<LinkCommandResult> {
  const linksDb = new LinksDatabase();
  const agent = options.agent ?? 'cursor';

  try {
    await linksDb.connect();

    const payload = parsePayload(readStdin());
    const event = options.event ?? (payload.hook_event_name as HookEventType);

    if (!event) {
      return {
        success: false,
        message: 'Missing event: provide --event or include hook_event_name in payload',
      };
    }

    // Route to agent-specific handler
    if (agent === 'claude-code') {
      return routeClaudeCodeEvent(linksDb, event, payload);
    }

    return routeCursorEvent(linksDb, event, payload, agent);
  } finally {
    linksDb.close();
  }
}

/**
 * Route Claude Code events to handlers
 */
function routeClaudeCodeEvent(
  linksDb: LinksDatabase,
  event: HookEventType,
  payload: Record<string, unknown>
): Promise<LinkCommandResult> {
  switch (event) {
    case 'SessionEnd':
    case 'Stop':
      return handleClaudeCodeStop(linksDb, payload);

    default:
      return Promise.resolve({
        success: true,
        message: `Ignored unknown Claude Code event: ${event}`,
      });
  }
}

/**
 * Route Cursor events to handlers
 */
function routeCursorEvent(
  linksDb: LinksDatabase,
  event: HookEventType,
  payload: Record<string, unknown>,
  agent: AgentName
): Promise<LinkCommandResult> {
  switch (event) {
    case 'afterFileEdit':
      return handleAfterFileEdit(linksDb, payload as Partial<CursorHookPayload>, agent);

    case 'stop':
      return handleStop(linksDb, payload as Partial<CursorHookPayload>, agent);

    default:
      return Promise.resolve({
        success: true,
        message: `Ignored unknown event: ${event}`,
      });
  }
}
