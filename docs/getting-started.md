# Getting Started with MCP Server Boilerplate

This guide will walk you through setting up and customizing your MCP server using this boilerplate.

## Prerequisites

- **Node.js** (v18 or higher)
- **Yarn** package manager
- **TypeScript** knowledge (recommended)
- **Basic understanding of MCP** (Model Context Protocol)

## Quick Setup

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd mcp-server-boilerplate
yarn install
```

### 2. Build the Project

```bash
yarn build
```

### 3. Test the Server

```bash
# Run tests
yarn test

# Start the MCP inspector for interactive testing
yarn inspector
```

### 4. Configure Your MCP Client

Add your server to your MCP client configuration (e.g., `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "my-custom-server": {
      "command": "node",
      "args": ["path/to/your/dist/server.js"]
    }
  }
}
```

## Understanding the Structure

### Core Files

- **`src/server.ts`** - Main server setup and tool registration
- **`src/tools/example-tools.ts`** - Example tool implementations
- **`src/utils/formatter.ts`** - Response formatting utilities

### Example Tools Included

1. **`get_data`** - Demonstrates data retrieval with filtering
2. **`search_items`** - Shows search functionality with multiple modes
3. **`analyze_data`** - Example analytics with optional chart data
4. **`get_system_info`** - System utilities for date/time information

## Customizing Your Server

### Step 1: Define Your Data Model

Create types for your domain:

```typescript
// src/types/your-domain.ts
export interface YourDataType {
  id: string;
  name: string;
  // ... your fields
}
```

### Step 2: Implement Your Business Logic

Replace the example functions in `src/tools/example-tools.ts`:

```typescript
export async function yourCustomOperation(input: YourInputType): Promise<YourOutputType> {
  // Connect to your data source
  // Process the input
  // Return formatted results
}
```

### Step 3: Register Your Tools

Update `src/server.ts` to register your tools:

```typescript
server.tool(
  'your_tool_name',
  'Clear description of what your tool does',
  {
    // Zod schema for input validation
    param1: z.string().describe('Parameter description'),
    param2: z.number().optional().default(10)
  },
  async (input) => {
    const result = await yourCustomOperation(input);
    return {
      content: [{
        type: 'text',
        text: formatResponse(result, input.outputMode)
      }]
    };
  }
);
```

### Step 4: Add Your Data Sources

Common patterns for data integration:

#### Database Connection
```typescript
// src/data/database.ts
import sqlite3 from 'sqlite3';

export class DatabaseConnection {
  // ... your database logic
}
```

#### File System Access
```typescript
// src/data/filesystem.ts
import fs from 'fs/promises';

export async function readFiles(pattern: string) {
  // ... your file system logic
}
```

#### External API Integration
```typescript
// src/data/external-api.ts
import axios from 'axios';

export async function fetchFromAPI(endpoint: string) {
  // ... your API integration
}
```

## Development Workflow

### 1. Development Mode

```bash
# Watch for changes and rebuild automatically
yarn watch
```

### 2. Testing

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test --watch

# Run tests with UI
yarn test:ui
```

### 3. Interactive Testing

```bash
# Start MCP inspector for manual testing
yarn inspector
```

### 4. Production Build

```bash
# Build for production
yarn build

# Start the server
yarn start
```

## Adding Dependencies

### Common Dependencies

```bash
# Database
yarn add sqlite3 @types/sqlite3

# HTTP requests
yarn add axios

# File processing
yarn add fs-extra @types/fs-extra

# Date handling
yarn add date-fns

# Validation
yarn add joi  # Alternative to Zod

# Logging
yarn add winston
```

## Best Practices

### Tool Design

1. **Clear Descriptions**: Write detailed tool descriptions for AI assistants
2. **Input Validation**: Use Zod schemas for all parameters
3. **Error Handling**: Provide meaningful error messages
4. **Consistent Output**: Use the `formatResponse` utility

### Performance

1. **Async Operations**: Use async/await for all I/O
2. **Resource Management**: Clean up connections and resources
3. **Caching**: Implement caching for expensive operations
4. **Pagination**: Support pagination for large datasets

### Security

1. **Input Validation**: Validate all inputs
2. **Error Messages**: Don't expose sensitive information
3. **Resource Limits**: Implement appropriate timeouts and limits
4. **Authentication**: Add authentication for sensitive operations

## Common Issues

### Build Errors

- Ensure all imports use `.js` extensions for local files
- Check TypeScript configuration in `tsconfig.json`
- Verify all dependencies are installed

### Runtime Errors

- Check MCP protocol compliance
- Verify tool registration syntax
- Ensure async operations are properly awaited

### Integration Issues

- Verify MCP client configuration
- Check server output for connection errors
- Test with MCP inspector first

## Next Steps

1. Replace example tools with your business logic
2. Add your data sources and connections
3. Write comprehensive tests for your tools
4. Add proper logging and monitoring
5. Deploy your server and integrate with MCP clients

## Resources

- [MCP Documentation](https://modelcontextprotocol.io/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Zod Documentation](https://zod.dev/)
- [Vitest Testing](https://vitest.dev/)

## Support

For questions and issues:
- Check the example implementations
- Review the test files for usage patterns
- Refer to the MCP protocol documentation