import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';

/**
 * Integration tests for the MCP server boilerplate
 * 
 * These tests verify that the server:
 * - Starts correctly
 * - Implements the MCP protocol properly
 * - Responds to tool calls
 * - Handles errors gracefully
 */

describe('MCP Server Integration Tests', () => {
  let serverProcess: ChildProcess;
  let serverReady = false;

  beforeEach(async () => {
    // Start the server process for testing
    serverProcess = spawn('node', ['dist/server.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for the server to be ready
    await new Promise<void>((resolve) => {
      serverProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Server started') || serverReady) {
          serverReady = true;
          resolve();
        }
      });

      // Resolve after a timeout if no explicit ready message
      setTimeout(() => {
        serverReady = true;
        resolve();
      }, 2000);
    });
  });

  afterEach(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
    serverReady = false;
  });

  async function sendRequest(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!serverProcess.stdin) {
        reject(new Error('Server stdin not available'));
        return;
      }

      let responseData = '';
      
      const onData = (data: Buffer) => {
        responseData += data.toString();
        
        // Try to parse JSON response
        try {
          const response = JSON.parse(responseData.trim());
          serverProcess.stdout?.off('data', onData);
          resolve(response);
        } catch (error) {
          // Continue collecting data if JSON is incomplete
        }
      };

      serverProcess.stdout?.on('data', onData);

      // Send the request
      serverProcess.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 5 seconds
      setTimeout(() => {
        serverProcess.stdout?.off('data', onData);
        reject(new Error('Request timeout'));
      }, 5000);
    });
  }

  it('should initialize correctly', async () => {
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    };

    const response = await sendRequest(initRequest);
    
    expect(response).toBeDefined();
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result).toBeDefined();
    expect(response.result.capabilities).toBeDefined();
    expect(response.result.serverInfo).toBeDefined();
    expect(response.result.serverInfo.name).toBe('mcp-server-boilerplate');
  });

  it('should list available tools', async () => {
    const toolsRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    };

    const response = await sendRequest(toolsRequest);
    
    expect(response).toBeDefined();
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(2);
    expect(response.result).toBeDefined();
    expect(response.result.tools).toBeInstanceOf(Array);
    
    // Check that our example tools are present
    const toolNames = response.result.tools.map((tool: any) => tool.name);
    expect(toolNames).toContain('get_data');
    expect(toolNames).toContain('search_items');
    expect(toolNames).toContain('analyze_data');
    expect(toolNames).toContain('get_system_info');
  });

  it('should call get_data tool successfully', async () => {
    const toolCallRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_data',
        arguments: {
          limit: 5,
          filter: 'sample',
          includeMetadata: true
        }
      }
    };

    const response = await sendRequest(toolCallRequest);
    
    expect(response).toBeDefined();
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(3);
    expect(response.result).toBeDefined();
    expect(response.result.content).toBeInstanceOf(Array);
    expect(response.result.content[0]).toHaveProperty('type', 'text');
    
    // Parse the response content
    const content = JSON.parse(response.result.content[0].text);
    expect(content).toHaveProperty('items');
    expect(content).toHaveProperty('totalFound');
    expect(content).toHaveProperty('filters');
    expect(content.items).toBeInstanceOf(Array);
  });

  it('should call search_items tool successfully', async () => {
    const toolCallRequest = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'search_items',
        arguments: {
          query: 'React',
          searchType: 'exact',
          maxResults: 3
        }
      }
    };

    const response = await sendRequest(toolCallRequest);
    
    expect(response).toBeDefined();
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(4);
    expect(response.result).toBeDefined();
    
    const content = JSON.parse(response.result.content[0].text);
    expect(content).toHaveProperty('items');
    expect(content).toHaveProperty('totalFound');
    expect(content).toHaveProperty('searchTerm', 'React');
    expect(content).toHaveProperty('searchType', 'exact');
  });

  it('should call get_system_info tool successfully', async () => {
    const toolCallRequest = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'get_system_info',
        arguments: {
          info: 'all'
        }
      }
    };

    const response = await sendRequest(toolCallRequest);
    
    expect(response).toBeDefined();
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(5);
    expect(response.result).toBeDefined();
    
    const content = response.result.content[0].text;
    expect(content).toContain('Current date:');
    expect(content).toContain('Timezone:');
    expect(content).toContain('Server version:');
  });

  it('should handle tool call errors gracefully', async () => {
    const toolCallRequest = {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'search_items',
        arguments: {
          // Missing required query parameter
          searchType: 'exact'
        }
      }
    };

    const response = await sendRequest(toolCallRequest);
    
    expect(response).toBeDefined();
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(6);
    
    // Should have either an error or a content with error message
    if (response.error) {
      expect(response.error).toBeDefined();
    } else {
      expect(response.result.content[0].text).toContain('Error:');
    }
  });

  it('should handle unknown tool calls', async () => {
    const toolCallRequest = {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'nonexistent_tool',
        arguments: {}
      }
    };

    const response = await sendRequest(toolCallRequest);
    
    expect(response).toBeDefined();
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(7);
    expect(response.error).toBeDefined();
  });
});