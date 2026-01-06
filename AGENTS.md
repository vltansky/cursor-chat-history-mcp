# Cursor Conversations MCP Server - Project Overview

## Core Concept
This project creates an MCP (Model Context Protocol) server that **exposes your Cursor conversation history** to AI assistants like Claude. It acts as a bridge between your local Cursor chat database and AI tools.

## Primary Goal
**Enable AI assistants to analyze your actual coding conversations** to provide personalized, context-aware assistance based on your real development patterns and history.

## Key Value Proposition
- **Personalized Coding Rules**: Generate coding standards from your actual conversations, not generic best practices
- **Pattern Recognition**: Identify recurring themes and solutions in your development work
- **Context-Aware Help**: Get assistance informed by your specific projects and coding style
- **Historical Insights**: Learn from past problem-solving sessions and apply proven solutions

## How It Works
1. **Local Access**: Reads your Cursor conversation database directly (no external services)
2. **MCP Protocol**: Exposes conversation data through standardized MCP tools
3. **AI Integration**: AI assistants can query, analyze, and extract insights from your chat history
4. **Privacy First**: All data stays local - no external API calls or data sharing

## Common Use Cases
- `"Analyze my React conversations and create component guidelines"`
- `"Generate TypeScript rules based on my actual coding patterns"`
- `"Find similar debugging sessions and extract solutions"`
- `"Create project documentation from relevant conversations"`

## Technical Architecture
- **Database**: SQLite access to Cursor's conversation storage at `src/database/`
- **MCP Server**: TypeScript implementation at `src/server.ts`
- **Tools**: Conversation analysis tools at `src/tools/`
- **Entry Point**: Main configuration in `package.json` and `README.md`

---

# General Project Guidelines
Use npm for package management

## Code Organization
- Follow the established directory structure in `src/`
- Group related functionality in modules
- Use barrel exports for clean public APIs

## Development Workflow
- Build with `yarn build` before testing
- Use TypeScript for all new code
- Follow patterns established in existing codebase

## File Extensions
- Use `.js` extensions for local imports (required for ESM)
- TypeScript files should be `.ts`

---

# MCP Server Development Guide

This guide covers best practices for developing Model Context Protocol (MCP) servers using the TypeScript SDK.

## Tool Registration Pattern

- **Use McpServer with Proper Description Format**
  - Tool descriptions are provided as a separate string parameter, not within the schema object
  - Pass the Zod schema shape directly as the third parameter
  - Import `z` from 'zod' for schema definitions

```typescript
// ✅ DO: Correct tool registration with description
server.tool(
  'my_tool',
  'Clear description of what this tool does and its purpose',
  {
    param1: z.string().min(1),
    param2: z.number().optional().default(10),
    param3: z.array(z.string()).optional()
  },
  async (input) => {
    // input is properly typed and validated
    return {
      content: [{ type: 'text', text: 'result' }]
    };
  }
);

// ❌ DON'T: Include description in schema object
server.tool(
  'my_tool',
  {
    description: 'Tool description', // This causes TypeScript errors
    param1: z.string().min(1),
    param2: z.number().optional().default(10)
  },
  async (input) => {
    // This pattern is incorrect
  }
);

// ❌ DON'T: Missing description entirely
server.tool(
  'my_tool',
  {
    param1: z.string().min(1),
    param2: z.number().optional().default(10)
  },
  async (input) => {
    // Tools without descriptions are less discoverable
  }
);
```

## Parameter Access Pattern

- **Direct Parameter Access**
  - Tool handlers receive validated parameters directly as the first argument
  - No need to access `request.params.arguments`
  - Parameters are automatically validated against the Zod schema

```typescript
// ✅ DO: Direct parameter access
async (input) => {
  // input is typed and validated
  const { conversationId, includeMetadata } = input;
}

// ❌ DON'T: Manual parameter extraction
async (request) => {
  const input = request.params.arguments as MyInputType;
}
```

## MCP-Specific Error Handling

- **MCP Tool Response Format**
  - Always return content in the expected MCP format
  - Use consistent error response structure
  - Include meaningful error messages for debugging

```typescript
async (input) => {
  try {
    const result = await myOperation(input);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
      }]
    };
  }
}
```

## Server Setup Pattern

- **Standard Server Initialization**
  - Use `McpServer` from the official SDK
  - Connect with `StdioServerTransport` for CLI tools
  - Await the connection to ensure proper setup

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'my-mcp-server',
  version: '1.0.0',
});

// Register tools with descriptions...

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Tool Description Best Practices

- **Write Clear, Actionable Descriptions**
  - Describe what the tool does and its purpose
  - Include key functionality and expected use cases
  - Mention important parameters or behavior
  - Keep descriptions concise but informative

```typescript
// ✅ DO: Clear, informative descriptions
server.tool(
  'list_conversations',
  'List Cursor conversations with optional filtering by keywords, code blocks, file patterns, and more. Returns conversation summaries ordered by most recent first.',
  { /* schema */ },
  async (input) => { /* handler */ }
);

server.tool(
  'get_conversation',
  'Retrieve the full content of a specific Cursor conversation by ID, including messages, code blocks, file references, and metadata.',
  { /* schema */ },
  async (input) => { /* handler */ }
);

// ❌ DON'T: Vague or missing descriptions
server.tool(
  'process_data',
  'Processes data', // Too vague
  { /* schema */ },
  async (input) => { /* handler */ }
);
```

## Testing MCP Servers

- **Manual Testing with JSON-RPC**
  - Test initialization with proper protocol version
  - Use `tools/list` to verify tool registration and descriptions
  - Use `tools/call` to test actual tool functionality

```bash
# Test initialization
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}' | node dist/server.js

# List available tools (should show descriptions)
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}' | node dist/server.js

# Call a tool
echo '{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "my_tool", "arguments": {"param1": "value"}}}' | node dist/server.js
```

## Common MCP Issues and Solutions

- **"Cannot read properties of undefined" Error**
  - Usually caused by incorrect tool registration format
  - Check that you're using the correct parameter order: name, description, schema, handler
  - Verify parameter access pattern (direct vs request.params.arguments)

- **Tool Not Appearing in List**
  - Ensure tool is registered before server.connect()
  - Check for TypeScript compilation errors
  - Verify Zod schema syntax is correct
  - Ensure description is provided as separate parameter

- **Missing Tool Descriptions**
  - Descriptions must be the second parameter in server.tool()
  - Don't include description in the schema object
  - Descriptions improve tool discoverability for clients

- **Type Errors in Tool Handlers**
  - Use Zod inference for input types: `z.infer<typeof mySchema>`
  - Ensure async/await patterns are correct

---

# Testing Guidelines

This guide covers testing patterns for the project using Vitest.

## Test File Organization

- **File Naming Convention**
  - Use `.test.ts` suffix for test files (e.g., `cache.test.ts`)
  - Place test files alongside their corresponding source files
  - Mirror the source file structure in test organization

```
src/
  utils/
    cache.ts
    cache.test.ts
    validation.ts
    validation.test.ts
  database/
    reader.ts
    reader.test.ts
```

- **Test Suite Structure**
  - Use descriptive `describe` blocks for logical grouping
  - Group related functionality together
  - Use nested `describe` blocks for complex modules

```typescript
describe('CursorDatabaseReader', () => {
  describe('Connection Management', () => {
    it('should connect to database successfully', () => {});
    it('should handle connection errors', () => {});
  });

  describe('Conversation Retrieval', () => {
    it('should get conversation by ID', () => {});
    it('should return null for non-existent conversation', () => {});
  });
});
```

## Vitest Configuration Patterns

- **Test Setup and Teardown**
  - Use `beforeEach` for test isolation
  - Use `afterEach` for cleanup
  - Use `beforeAll`/`afterAll` for expensive setup

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Cache', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache();
  });

  afterEach(() => {
    cache.destroy();
    vi.clearAllMocks();
  });
});
```

- **Mock Management**
  - Import `vi` from 'vitest' for mocking
  - Use `vi.useFakeTimers()` for time-based tests
  - Clear mocks in `afterEach` to prevent test pollution

```typescript
describe('TTL (Time-To-Live)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should expire entries after TTL', () => {
    cache = new Cache({ defaultTTL: 1000 });
    cache.set('key1', 'value1');

    vi.advanceTimersByTime(1001);

    expect(cache.get('key1')).toBeUndefined();
  });
});
```

## Error Testing Patterns

- **Error Class Testing**
  - Test error message construction
  - Test error inheritance hierarchy
  - Test custom error properties
  - Test error stack traces

```typescript
describe('DatabaseConnectionError', () => {
  it('should create database connection error', () => {
    const dbPath = '/path/to/database.db';
    const error = new DatabaseConnectionError(dbPath);

    expect(error.message).toBe(`Database error: Failed to connect to database at path: ${dbPath}`);
    expect(error.code).toBe('DATABASE_CONNECTION_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toBeInstanceOf(MCPError);
  });
});
```

- **Error Handling in Functions**
  - Test both success and failure paths
  - Test error propagation
  - Test error transformation

```typescript
describe('parseConversationJSON', () => {
  it('should parse valid conversation JSON', () => {
    const validJson = JSON.stringify({ composerId: 'test-123' });
    const result = parser.parseConversationJSON(validJson);
    expect(result.composerId).toBe('test-123');
  });

  it('should throw error for invalid JSON', () => {
    const invalidJson = '{ invalid json }';
    expect(() => parser.parseConversationJSON(invalidJson))
      .toThrow('Failed to parse conversation JSON');
  });
});
```

## Running Tests

- `yarn test` - Run all tests
- `yarn test:ui` - Run tests with UI interface
- `yarn test --watch` - Run tests in watch mode
- `yarn test --coverage` - Run tests with coverage report

## Test Coverage Requirements

- Aim for 90%+ line coverage on utility functions
- Aim for 80%+ line coverage on database operations
- Ensure all error paths are tested
- Test all public API methods
