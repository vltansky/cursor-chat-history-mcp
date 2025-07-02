#!/usr/bin/env node

/*
 * WORKFLOW GUIDANCE FOR AI ASSISTANTS:
 *

* **ALWAYS START WITH PROJECT FILTERING** for project-specific analysis:
 * 1. DISCOVERY: Use list_conversations with projectPath parameter to find project-specific conversations
 * 2. ANALYTICS: Use get_conversation_analytics with projectPath and ["files", "languages"] breakdowns
 *    - Files/languages breakdowns contain conversation IDs in their arrays!
 * 3. DEEP DIVE: Use get_conversation with specific conversation IDs from step 1 or 2
 * 4. ANALYSIS: Use analytics tools (find_related, extract_elements) for insights
 * 5. DATE FILTERING: Use get_system_info first when applying date filters to search_conversations
 *
 * RECOMMENDED PATTERN FOR PROJECT ANALYSIS:
 * - list_conversations(projectPath: "project-name", startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD")
 * - get_conversation_analytics(projectPath: "project-name", includeBreakdowns: ["files", "languages"])
 * - Extract conversation IDs from files/languages.conversations arrays
 * - get_conversation(conversationId: "id-from-breakdown") for each relevant conversation
 *
 * PROJECT PATH EXAMPLES:
 * - "my-app" (project name)
 * - "/Users/name/Projects/my-app" (full path)
 * - "editor-elements" (project name from path like /Users/name/Projects/editor-elements)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { z } from 'zod';
import { formatResponse } from './utils/formatter.js';
import { 
  exampleDataOperation,
  exampleSearchOperation,
  exampleAnalysisOperation 
} from './tools/example-tools.js';

const server = new McpServer({
  name: 'mcp-server-boilerplate',
  version: '0.1.0',
});

// Example Tool 1: Simple data retrieval
server.tool(
  'get_data',
  'Retrieve data from your custom data source with optional filtering and pagination. This demonstrates basic data retrieval patterns with validation.',
  {
    limit: z.number().min(1).max(100).optional().default(10).describe('Maximum number of items to return (1-100)'),
    filter: z.string().optional().describe('Filter criteria for the data'),
    includeMetadata: z.boolean().optional().default(false).describe('Include additional metadata in the response'),
    outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format: "json" for formatted JSON (default), "compact-json" for minified JSON')
  },
  async (input) => {
    try {
      const result = await exampleDataOperation({
        limit: input.limit,
        filter: input.filter,
        includeMetadata: input.includeMetadata
      });

      return {
        content: [{
          type: 'text',
          text: formatResponse(result, input.outputMode)
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
);

// Example Tool 2: Search functionality
server.tool(
  'search_items',
  'Search through your data using various search methods including text matching, filters, and advanced patterns.',
  {
    query: z.string().min(1).describe('Search query to find matching items'),
    searchType: z.enum(['exact', 'fuzzy', 'regex']).optional().default('exact').describe('Type of search to perform'),
    fields: z.array(z.string()).optional().describe('Specific fields to search within'),
    maxResults: z.number().min(1).max(50).optional().default(10).describe('Maximum number of results to return'),
    outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format: "json" for formatted JSON (default), "compact-json" for minified JSON')
  },
  async (input) => {
    try {
      if (!input.query || input.query.trim() === '') {
        throw new Error('Search query is required');
      }

      const result = await exampleSearchOperation({
        query: input.query,
        searchType: input.searchType,
        fields: input.fields,
        maxResults: input.maxResults
      });

      return {
        content: [{
          type: 'text',
          text: formatResponse(result, input.outputMode)
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
);

// Example Tool 3: Analytics and processing
server.tool(
  'analyze_data',
  'Perform analysis on your data to extract insights, patterns, and statistics. Demonstrates more complex processing operations.',
  {
    analysisType: z.enum(['summary', 'trends', 'patterns', 'detailed']).optional().default('summary').describe('Type of analysis to perform'),
    timeRange: z.object({
      start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      end: z.string().optional().describe('End date (YYYY-MM-DD)')
    }).optional().describe('Time range for analysis'),
    includeCharts: z.boolean().optional().default(false).describe('Include chart data in the response'),
    groupBy: z.array(z.string()).optional().describe('Fields to group analysis results by'),
    outputMode: z.enum(['json', 'compact-json']).optional().default('json').describe('Output format: "json" for formatted JSON (default), "compact-json" for minified JSON')
  },
  async (input) => {
    try {
      const result = await exampleAnalysisOperation({
        analysisType: input.analysisType,
        timeRange: input.timeRange,
        includeCharts: input.includeCharts,
        groupBy: input.groupBy
      });

      return {
        content: [{
          type: 'text',
          text: formatResponse(result, input.outputMode)
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
);

// Example Tool 4: System utilities
server.tool(
  'get_system_info',
  'Get system information and utilities. Provides current date, timezone, and other helpful context for your MCP server.',
  {
    info: z.enum(['date', 'timezone', 'version', 'all']).optional().default('all').describe('Type of system information to retrieve')
  },
  async (input) => {
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const version = '0.1.0';

    let response = '';

    switch (input.info) {
      case 'date':
        response = `Current date: ${currentDate}`;
        break;
      case 'timezone':
        response = `Timezone: ${timezone}`;
        break;
      case 'version':
        response = `Server version: ${version}`;
        break;
      default:
        response = [
          `Current date: ${currentDate}`,
          `Current time: ${currentTime}`,
          `Timezone: ${timezone}`,
          `Server version: ${version}`,
          ``,
          `Use this information for date filtering and context.`
        ].join('\n');
    }

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
