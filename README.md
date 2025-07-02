# MCP Server Boilerplate

**A TypeScript template for building Model Context Protocol (MCP) servers.**

This boilerplate provides a solid foundation for creating MCP servers that can integrate with Cursor, Claude, and other AI assistants. It includes best practices, example tools, proper error handling, and a well-structured TypeScript codebase.

## What This Template Provides

- **Complete MCP Server Setup**: Ready-to-use server with proper configuration
- **Example Tools**: Demonstrates common MCP tool patterns and best practices
- **TypeScript Integration**: Full type safety with Zod validation
- **Error Handling**: Robust error handling patterns throughout
- **Testing Setup**: Vitest configuration for unit testing
- **Development Workflow**: Build, watch, and inspection scripts

## Key Features

**Type-Safe Development**: Built with TypeScript and Zod for runtime validation and compile-time safety.

**Modular Architecture**: Well-organized code structure with separate modules for tools, utilities, and types.

**Example Patterns**: Demonstrates data retrieval, search, analytics, and system utilities.

**Development Ready**: Includes hot reload, testing, and MCP inspector integration.

## Quick Start

### 1. Clone and Setup
```bash
git clone <your-repo-url>
cd mcp-server-boilerplate
yarn install
yarn build
```

### 2. Configure MCP Client
Add to your `.cursor/mcp.json` or other MCP client configuration:

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

### 3. Start Developing
```bash
yarn watch  # Start development with hot reload
```

### 4. Test Your Tools
Use the MCP inspector to test your tools:
```bash
yarn inspector
```

## Example Tools Included

### Core Tools

- **`get_data`** - Demonstrates data retrieval with filtering and pagination
- **`search_items`** - Shows search functionality with multiple search types (exact, fuzzy, regex)
- **`analyze_data`** - Example analytics tool with chart data generation
- **`get_system_info`** - System utilities for date, timezone, and version information

### Tool Patterns Demonstrated

- **Parameter Validation**: Using Zod schemas for type-safe input validation
- **Error Handling**: Consistent error handling and user-friendly error messages
- **Async Operations**: Proper async/await patterns with timeout simulation
- **Response Formatting**: JSON and compact-JSON output modes
- **Type Safety**: Full TypeScript integration with proper type inference

## Project Structure

```
src/
├── server.ts              # Main MCP server setup and tool registration
├── tools/
│   └── example-tools.ts    # Example tool implementations
└── utils/
    └── formatter.ts        # Response formatting utilities

docs/                       # Documentation files
package.json               # Dependencies and scripts
tsconfig.json              # TypeScript configuration
vitest.config.ts           # Testing configuration
```

## Customizing for Your Use Case

### 1. Replace Example Tools

Edit `src/tools/example-tools.ts` to implement your business logic:

```typescript
export async function yourCustomOperation(input: YourInputType): Promise<YourOutputType> {
  // Your implementation here
  return result;
}
```

### 2. Update Server Registration

Modify `src/server.ts` to register your tools:

```typescript
server.tool(
  'your_tool_name',
  'Description of what your tool does',
  {
    // Zod schema for parameters
    param1: z.string().describe('Parameter description'),
    param2: z.number().optional().default(10)
  },
  async (input) => {
    // Tool implementation
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

### 3. Add Your Data Layer

Create modules for your specific data sources:

```
src/
├── database/          # Database connections and queries
├── external-apis/     # External API integrations
├── file-system/       # File system operations
└── your-domain/       # Your business logic
```

## Development Workflow

### Available Scripts

- `yarn build` - Compile TypeScript to JavaScript
- `yarn watch` - Watch mode for development
- `yarn start` - Run the compiled server
- `yarn test` - Run unit tests
- `yarn test:ui` - Run tests with UI
- `yarn inspector` - Start MCP inspector for testing tools

### Testing Your Tools

1. **Unit Tests**: Add tests alongside your tool files
2. **Integration Testing**: Use the MCP inspector to test tool behavior
3. **Manual Testing**: Test with actual MCP clients like Cursor

### Adding Dependencies

For data sources, add appropriate dependencies:

```bash
# Database
yarn add sqlite3 @types/sqlite3

# HTTP requests
yarn add axios

# File processing
yarn add fs-extra @types/fs-extra

# Date handling
yarn add date-fns
```

## MCP Best Practices

### Tool Design

- **Clear Descriptions**: Write detailed tool descriptions for AI assistants
- **Parameter Validation**: Use Zod for runtime validation
- **Error Handling**: Provide meaningful error messages
- **Output Consistency**: Use consistent response formats

### Performance

- **Async Operations**: Use async/await for all I/O operations
- **Resource Management**: Clean up resources properly
- **Caching**: Implement caching for expensive operations
- **Pagination**: Support pagination for large datasets

### Security

- **Input Validation**: Validate all inputs with Zod
- **Error Messages**: Don't expose sensitive information in errors
- **Resource Limits**: Implement appropriate limits and timeouts
- **Authentication**: Add authentication if accessing sensitive data

## Common Use Cases

### File System Tools
- File search and indexing
- Content analysis
- Code parsing and analysis

### Database Integration
- Query interfaces
- Data analysis and reporting
- Schema exploration

### External API Integration
- API wrapping and simplification
- Data aggregation from multiple sources
- Rate limiting and caching

### Development Tools
- Code generation
- Testing utilities
- Build and deployment helpers

## Contributing

1. Fork this repository
2. Create your feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - feel free to use this template for your own projects.

## Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Zod Documentation](https://zod.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

**Ready to build your MCP server?** Start by customizing the example tools in `src/tools/example-tools.ts` and updating the server registration in `src/server.ts`.