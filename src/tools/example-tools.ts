/*
 * Example Tools for MCP Server Boilerplate
 * 
 * These are template functions that demonstrate common patterns for MCP tools.
 * Replace these with your own business logic and data operations.
 */

import { z } from 'zod';

// Example types for demonstration
export interface ExampleItem {
  id: string;
  title: string;
  description: string;
  category: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ExampleSearchResult {
  items: ExampleItem[];
  totalFound: number;
  searchTerm: string;
  searchType: string;
}

export interface ExampleAnalysis {
  analysisType: string;
  summary: {
    totalItems: number;
    categories: Record<string, number>;
    trends: string[];
  };
  timeRange?: {
    start?: string;
    end?: string;
  };
  charts?: Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
}

// Input type schemas
const dataOperationInputSchema = z.object({
  limit: z.number().optional().default(10),
  filter: z.string().optional(),
  includeMetadata: z.boolean().optional().default(false)
});

const searchOperationInputSchema = z.object({
  query: z.string(),
  searchType: z.enum(['exact', 'fuzzy', 'regex']).optional().default('exact'),
  fields: z.array(z.string()).optional(),
  maxResults: z.number().optional().default(10)
});

const analysisOperationInputSchema = z.object({
  analysisType: z.enum(['summary', 'trends', 'patterns', 'detailed']).optional().default('summary'),
  timeRange: z.object({
    start: z.string().optional(),
    end: z.string().optional()
  }).optional(),
  includeCharts: z.boolean().optional().default(false),
  groupBy: z.array(z.string()).optional()
});

// Type inference from schemas
export type DataOperationInput = z.infer<typeof dataOperationInputSchema>;
export type SearchOperationInput = z.infer<typeof searchOperationInputSchema>;
export type AnalysisOperationInput = z.infer<typeof analysisOperationInputSchema>;

/**
 * Example data retrieval operation
 * Replace this with your actual data fetching logic
 */
export async function exampleDataOperation(input: DataOperationInput): Promise<{
  items: ExampleItem[];
  totalFound: number;
  filters: DataOperationInput;
}> {
  // Simulate async operation
  await new Promise(resolve => setTimeout(resolve, 100));

  // Example data - replace with actual data source
  const allItems: ExampleItem[] = [
    {
      id: '1',
      title: 'Example Item 1',
      description: 'This is a sample item for demonstration',
      category: 'sample',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    },
    {
      id: '2',
      title: 'Example Item 2',
      description: 'Another sample item with different category',
      category: 'demo',
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z'
    },
    {
      id: '3',
      title: 'Example Item 3',
      description: 'Third sample item for testing filters',
      category: 'test',
      metadata: { tags: ['important', 'featured'] },
      createdAt: '2024-01-03T00:00:00Z',
      updatedAt: '2024-01-03T00:00:00Z'
    }
  ];

  // Apply filtering
  let filteredItems = allItems;
  if (input.filter) {
    filteredItems = allItems.filter(item => 
      item.title.toLowerCase().includes(input.filter!.toLowerCase()) ||
      item.description.toLowerCase().includes(input.filter!.toLowerCase()) ||
      item.category.toLowerCase().includes(input.filter!.toLowerCase())
    );
  }

  // Apply limit
  const limitedItems = filteredItems.slice(0, input.limit);

  // Add metadata if requested
  const finalItems = limitedItems.map(item => ({
    ...item,
    metadata: input.includeMetadata ? { 
      ...item.metadata, 
      processingTime: new Date().toISOString(),
      source: 'example-data-source'
    } : item.metadata
  }));

  return {
    items: finalItems,
    totalFound: filteredItems.length,
    filters: input
  };
}

/**
 * Example search operation
 * Replace this with your actual search implementation
 */
export async function exampleSearchOperation(input: SearchOperationInput): Promise<ExampleSearchResult> {
  // Simulate async operation
  await new Promise(resolve => setTimeout(resolve, 150));

  // Example search logic - replace with actual search implementation
  const allItems: ExampleItem[] = [
    {
      id: '1',
      title: 'React Component Guide',
      description: 'Comprehensive guide to building React components',
      category: 'documentation',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    },
    {
      id: '2',
      title: 'TypeScript Patterns',
      description: 'Common TypeScript patterns and best practices',
      category: 'tutorial',
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z'
    },
    {
      id: '3',
      title: 'API Design Guidelines',
      description: 'Guidelines for designing RESTful APIs',
      category: 'documentation',
      createdAt: '2024-01-03T00:00:00Z',
      updatedAt: '2024-01-03T00:00:00Z'
    }
  ];

  let searchResults: ExampleItem[] = [];

  switch (input.searchType) {
    case 'exact':
      searchResults = allItems.filter(item => 
        item.title.toLowerCase().includes(input.query.toLowerCase()) ||
        item.description.toLowerCase().includes(input.query.toLowerCase())
      );
      break;
    
    case 'fuzzy':
      // Simple fuzzy search implementation
      const queryWords = input.query.toLowerCase().split(' ');
      searchResults = allItems.filter(item => {
        const itemText = `${item.title} ${item.description}`.toLowerCase();
        return queryWords.some((word: string) => itemText.includes(word));
      });
      break;
    
    case 'regex':
      try {
        const regex = new RegExp(input.query, 'i');
        searchResults = allItems.filter(item => 
          regex.test(item.title) || regex.test(item.description)
        );
      } catch (error) {
        throw new Error(`Invalid regex pattern: ${input.query}`);
      }
      break;
  }

  // Apply field filtering if specified
  if (input.fields && input.fields.length > 0) {
    searchResults = searchResults.filter(item => {
      return input.fields!.some((field: string) => {
        const fieldValue = (item as any)[field];
        return fieldValue && 
          fieldValue.toString().toLowerCase().includes(input.query.toLowerCase());
      });
    });
  }

  // Apply result limit
  const limitedResults = searchResults.slice(0, input.maxResults);

  return {
    items: limitedResults,
    totalFound: searchResults.length,
    searchTerm: input.query,
    searchType: input.searchType
  };
}

/**
 * Example analysis operation
 * Replace this with your actual analytics implementation
 */
export async function exampleAnalysisOperation(input: AnalysisOperationInput): Promise<ExampleAnalysis> {
  // Simulate async operation
  await new Promise(resolve => setTimeout(resolve, 200));

  // Example analysis logic - replace with actual analytics
  const mockData = {
    totalItems: 150,
    categories: {
      'documentation': 45,
      'tutorial': 38,
      'reference': 32,
      'example': 25,
      'other': 10
    },
    trends: [
      'Increasing interest in TypeScript patterns',
      'More focus on component architecture',
      'Growing adoption of modern JavaScript features'
    ]
  };

  const analysis: ExampleAnalysis = {
    analysisType: input.analysisType,
    summary: mockData,
    timeRange: input.timeRange
  };

  // Add chart data if requested
  if (input.includeCharts) {
    analysis.charts = [
      {
        type: 'bar',
        data: {
          labels: Object.keys(mockData.categories),
          values: Object.values(mockData.categories)
        }
      },
      {
        type: 'line',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
          values: [10, 15, 12, 20, 18]
        }
      }
    ];
  }

  return analysis;
}