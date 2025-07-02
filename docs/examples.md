# MCP Server Examples

This document provides practical examples of common MCP server patterns and implementations.

## Basic Tool Examples

### 1. Simple Data Retrieval Tool

```typescript
// src/tools/data-tools.ts
server.tool(
  'get_users',
  'Retrieve user information with optional filtering',
  {
    limit: z.number().min(1).max(100).optional().default(10),
    role: z.enum(['admin', 'user', 'guest']).optional(),
    active: z.boolean().optional()
  },
  async (input) => {
    try {
      const users = await getUsersFromDatabase({
        limit: input.limit,
        role: input.role,
        active: input.active
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            users,
            count: users.length,
            filters: input
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error retrieving users: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }
);
```

### 2. File System Tool

```typescript
server.tool(
  'search_files',
  'Search for files in a directory with pattern matching',
  {
    directory: z.string().describe('Directory to search in'),
    pattern: z.string().describe('File pattern to match (e.g., "*.ts", "README*")'),
    recursive: z.boolean().optional().default(true),
    maxResults: z.number().min(1).max(1000).optional().default(100)
  },
  async (input) => {
    try {
      const files = await searchFiles({
        directory: input.directory,
        pattern: input.pattern,
        recursive: input.recursive,
        maxResults: input.maxResults
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            files: files.map(file => ({
              path: file.path,
              size: file.size,
              modified: file.mtime,
              type: file.isDirectory ? 'directory' : 'file'
            })),
            totalFound: files.length,
            searchCriteria: input
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error searching files: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }
);
```

### 3. External API Integration Tool

```typescript
server.tool(
  'fetch_weather',
  'Get weather information for a specific location',
  {
    location: z.string().min(1).describe('City name or coordinates'),
    units: z.enum(['metric', 'imperial']).optional().default('metric'),
    includeForecast: z.boolean().optional().default(false)
  },
  async (input) => {
    try {
      const weatherData = await fetchWeatherData({
        location: input.location,
        units: input.units,
        includeForecast: input.includeForecast
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            current: {
              temperature: weatherData.temperature,
              description: weatherData.description,
              humidity: weatherData.humidity,
              windSpeed: weatherData.windSpeed
            },
            location: weatherData.location,
            forecast: input.includeForecast ? weatherData.forecast : undefined,
            units: input.units
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error fetching weather: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }
);
```

## Advanced Patterns

### 1. Streaming Tool for Large Datasets

```typescript
server.tool(
  'process_large_dataset',
  'Process a large dataset with progress updates',
  {
    dataSource: z.string().describe('Path to data source'),
    batchSize: z.number().min(1).max(10000).optional().default(1000),
    operation: z.enum(['analyze', 'transform', 'validate']).describe('Operation to perform')
  },
  async (input) => {
    try {
      const processor = new DataProcessor({
        source: input.dataSource,
        batchSize: input.batchSize
      });

      const results = [];
      let processed = 0;
      const total = await processor.getTotalRecords();

      for await (const batch of processor.processBatches(input.operation)) {
        results.push(...batch.results);
        processed += batch.count;
        
        // Optionally emit progress updates
        console.log(`Progress: ${processed}/${total} (${Math.round(processed/total * 100)}%)`);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            operation: input.operation,
            totalProcessed: processed,
            results: results.slice(0, 100), // Limit output size
            summary: {
              successCount: results.filter(r => r.success).length,
              errorCount: results.filter(r => !r.success).length
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error processing dataset: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }
);
```

### 2. Caching Tool

```typescript
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, any>({
  max: 1000,
  ttl: 1000 * 60 * 5 // 5 minutes
});

server.tool(
  'cached_computation',
  'Perform expensive computation with caching',
  {
    input: z.string().describe('Input data for computation'),
    forceRefresh: z.boolean().optional().default(false).describe('Bypass cache and force fresh computation')
  },
  async (input) => {
    try {
      const cacheKey = `computation:${Buffer.from(input.input).toString('base64')}`;
      
      if (!input.forceRefresh && cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              result: cached,
              fromCache: true,
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }

      const result = await performExpensiveComputation(input.input);
      cache.set(cacheKey, result);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            result,
            fromCache: false,
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error in computation: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }
);
```

### 3. Database Query Tool with Transactions

```typescript
server.tool(
  'execute_query',
  'Execute database queries with transaction support',
  {
    query: z.string().describe('SQL query to execute'),
    parameters: z.array(z.any()).optional().describe('Query parameters'),
    useTransaction: z.boolean().optional().default(false),
    readOnly: z.boolean().optional().default(true)
  },
  async (input) => {
    let connection;
    let transaction;
    
    try {
      connection = await getDbConnection();
      
      if (input.useTransaction && !input.readOnly) {
        transaction = await connection.beginTransaction();
      }

      const result = await connection.query(input.query, input.parameters);
      
      if (transaction) {
        await transaction.commit();
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            rows: result.rows,
            rowCount: result.rowCount,
            fields: result.fields?.map(f => ({ name: f.name, type: f.type })),
            executionTime: result.executionTime,
            query: input.query
          }, null, 2)
        }]
      };
    } catch (error) {
      if (transaction) {
        await transaction.rollback();
      }
      
      return {
        content: [{
          type: 'text',
          text: `Database error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    } finally {
      if (connection) {
        await connection.close();
      }
    }
  }
);
```

## Data Source Examples

### 1. SQLite Database Connection

```typescript
// src/data/sqlite-connection.ts
import sqlite3 from 'sqlite3';
import { promisify } from 'util';

export class SQLiteConnection {
  private db: sqlite3.Database;

  constructor(dbPath: string) {
    this.db = new sqlite3.Database(dbPath);
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    const all = promisify(this.db.all.bind(this.db));
    return await all(sql, params);
  }

  async get(sql: string, params: any[] = []): Promise<any> {
    const get = promisify(this.db.get.bind(this.db));
    return await get(sql, params);
  }

  async close(): Promise<void> {
    const close = promisify(this.db.close.bind(this.db));
    await close();
  }
}
```

### 2. File System Operations

```typescript
// src/data/filesystem.ts
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

export interface FileInfo {
  path: string;
  size: number;
  mtime: Date;
  isDirectory: boolean;
  content?: string;
}

export async function searchFiles(options: {
  directory: string;
  pattern: string;
  recursive?: boolean;
  maxResults?: number;
}): Promise<FileInfo[]> {
  const globPattern = options.recursive 
    ? path.join(options.directory, '**', options.pattern)
    : path.join(options.directory, options.pattern);

  const files = await glob(globPattern, {
    maxDepth: options.recursive ? undefined : 1
  });

  const results: FileInfo[] = [];
  
  for (const file of files.slice(0, options.maxResults)) {
    try {
      const stats = await fs.stat(file);
      results.push({
        path: file,
        size: stats.size,
        mtime: stats.mtime,
        isDirectory: stats.isDirectory()
      });
    } catch (error) {
      // Skip files that can't be accessed
      continue;
    }
  }

  return results;
}

export async function readFileContent(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf-8');
}
```

### 3. HTTP API Client

```typescript
// src/data/api-client.ts
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export class APIClient {
  private client: AxiosInstance;

  constructor(baseURL: string, defaultHeaders: Record<string, string> = {}) {
    this.client = axios.create({
      baseURL,
      headers: defaultHeaders,
      timeout: 10000
    });

    // Request interceptor for logging
    this.client.interceptors.request.use(config => {
      console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        console.error(`API Error: ${error.message}`);
        throw error;
      }
    );
  }

  async get<T>(endpoint: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get(endpoint, config);
    return response.data;
  }

  async post<T>(endpoint: string, data: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post(endpoint, data, config);
    return response.data;
  }

  async put<T>(endpoint: string, data: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put(endpoint, data, config);
    return response.data;
  }

  async delete<T>(endpoint: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete(endpoint, config);
    return response.data;
  }
}
```

## Testing Examples

### 1. Tool Unit Tests

```typescript
// src/tools/data-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockDatabase } from '../test-utils/mock-database.js';

describe('Data Tools', () => {
  let mockDb: MockDatabase;

  beforeEach(() => {
    mockDb = new MockDatabase();
  });

  afterEach(() => {
    mockDb.close();
  });

  it('should retrieve users with filters', async () => {
    // Setup test data
    await mockDb.insertUser({ id: '1', name: 'John', role: 'admin', active: true });
    await mockDb.insertUser({ id: '2', name: 'Jane', role: 'user', active: false });

    const result = await getUsersFromDatabase({
      limit: 10,
      role: 'admin',
      active: true
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John');
  });
});
```

### 2. Integration Tests

```typescript
// src/integration/server.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';

describe('Server Integration', () => {
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    serverProcess = spawn('node', ['dist/server.js']);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for startup
  });

  afterAll(() => {
    serverProcess.kill();
  });

  it('should respond to tool calls', async () => {
    // Test implementation
  });
});
```

## Error Handling Patterns

### 1. Graceful Error Handling

```typescript
async function withErrorHandling<T>(
  operation: () => Promise<T>,
  errorMessage: string
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const result = await operation();
    return {
      content: [{
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      content: [{
        type: 'text',
        text: `${errorMessage}: ${message}`
      }]
    };
  }
}

// Usage in tools
server.tool(
  'safe_operation',
  'Operation with built-in error handling',
  { input: z.string() },
  async (input) => {
    return withErrorHandling(
      async () => await performRiskyOperation(input.input),
      'Failed to perform operation'
    );
  }
);
```

### 2. Input Validation

```typescript
const UserSchema = z.object({
  id: z.string().uuid('Invalid user ID format'),
  email: z.string().email('Invalid email address'),
  age: z.number().min(0).max(150, 'Age must be between 0 and 150'),
  role: z.enum(['admin', 'user', 'guest'], {
    errorMap: () => ({ message: 'Role must be admin, user, or guest' })
  })
});

server.tool(
  'create_user',
  'Create a new user with validation',
  {
    userData: z.string().describe('JSON string containing user data')
  },
  async (input) => {
    try {
      const userData = JSON.parse(input.userData);
      const validatedUser = UserSchema.parse(userData);
      
      const createdUser = await createUser(validatedUser);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, user: createdUser }, null, 2)
        }]
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          content: [{
            type: 'text',
            text: `Validation error: ${error.errors.map(e => e.message).join(', ')}`
          }]
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: `Error creating user: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }
);
```

These examples demonstrate common patterns and best practices for building robust MCP servers. Adapt them to your specific use case and requirements.