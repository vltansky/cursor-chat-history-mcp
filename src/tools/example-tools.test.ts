import { describe, it, expect } from 'vitest';
import { 
  exampleDataOperation, 
  exampleSearchOperation, 
  exampleAnalysisOperation,
  type DataOperationInput,
  type SearchOperationInput,
  type AnalysisOperationInput
} from './example-tools.js';

/**
 * Unit tests for example tools
 * 
 * These tests demonstrate how to test MCP tool functions.
 * Replace these with tests for your actual business logic.
 */

describe('Example Tools', () => {
  describe('exampleDataOperation', () => {
    it('should return data with correct structure', async () => {
      const input: DataOperationInput = {
        limit: 5,
        filter: 'sample',
        includeMetadata: true
      };

      const result = await exampleDataOperation(input);

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('totalFound');
      expect(result).toHaveProperty('filters');
      expect(result.items).toBeInstanceOf(Array);
      expect(result.items.length).toBeLessThanOrEqual(5);
      expect(result.filters).toEqual(input);
    });

    it('should filter results correctly', async () => {
      const input: DataOperationInput = {
        limit: 10,
        filter: 'sample',
        includeMetadata: false
      };

      const result = await exampleDataOperation(input);

      // Should only return items that match the filter
      result.items.forEach(item => {
        const itemText = `${item.title} ${item.description} ${item.category}`.toLowerCase();
        expect(itemText).toContain('sample');
      });
    });

    it('should apply limit correctly', async () => {
      const input: DataOperationInput = {
        limit: 2,
        includeMetadata: false
      };

      const result = await exampleDataOperation(input);

      expect(result.items.length).toBeLessThanOrEqual(2);
    });

    it('should include metadata when requested', async () => {
      const input: DataOperationInput = {
        limit: 5,
        includeMetadata: true
      };

      const result = await exampleDataOperation(input);

      result.items.forEach(item => {
        if (item.metadata) {
          expect(item.metadata).toHaveProperty('processingTime');
          expect(item.metadata).toHaveProperty('source');
        }
      });
    });
  });

  describe('exampleSearchOperation', () => {
    it('should perform exact search correctly', async () => {
      const input: SearchOperationInput = {
        query: 'React',
        searchType: 'exact',
        maxResults: 10
      };

      const result = await exampleSearchOperation(input);

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('totalFound');
      expect(result).toHaveProperty('searchTerm', 'React');
      expect(result).toHaveProperty('searchType', 'exact');
      expect(result.items).toBeInstanceOf(Array);
    });

    it('should perform fuzzy search correctly', async () => {
      const input: SearchOperationInput = {
        query: 'TypeScript patterns',
        searchType: 'fuzzy',
        maxResults: 5
      };

      const result = await exampleSearchOperation(input);

      expect(result.searchType).toBe('fuzzy');
      expect(result.searchTerm).toBe('TypeScript patterns');
    });

    it('should handle regex search', async () => {
      const input: SearchOperationInput = {
        query: '^React.*Guide$',
        searchType: 'regex',
        maxResults: 5
      };

      const result = await exampleSearchOperation(input);

      expect(result.searchType).toBe('regex');
    });

    it('should handle invalid regex gracefully', async () => {
      const input: SearchOperationInput = {
        query: '[invalid regex',
        searchType: 'regex',
        maxResults: 5
      };

      await expect(exampleSearchOperation(input)).rejects.toThrow('Invalid regex pattern');
    });

    it('should apply result limit', async () => {
      const input: SearchOperationInput = {
        query: 'Guide',
        searchType: 'exact',
        maxResults: 1
      };

      const result = await exampleSearchOperation(input);

      expect(result.items.length).toBeLessThanOrEqual(1);
    });

    it('should filter by specific fields', async () => {
      const input: SearchOperationInput = {
        query: 'documentation',
        searchType: 'exact',
        fields: ['category'],
        maxResults: 10
      };

      const result = await exampleSearchOperation(input);

      // Should only find items where the category field matches
      result.items.forEach(item => {
        expect(item.category.toLowerCase()).toContain('documentation');
      });
    });
  });

  describe('exampleAnalysisOperation', () => {
    it('should return analysis with correct structure', async () => {
      const input: AnalysisOperationInput = {
        analysisType: 'summary',
        includeCharts: false
      };

      const result = await exampleAnalysisOperation(input);

      expect(result).toHaveProperty('analysisType', 'summary');
      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('totalItems');
      expect(result.summary).toHaveProperty('categories');
      expect(result.summary).toHaveProperty('trends');
      expect(result.summary.categories).toBeInstanceOf(Object);
      expect(result.summary.trends).toBeInstanceOf(Array);
    });

    it('should include charts when requested', async () => {
      const input: AnalysisOperationInput = {
        analysisType: 'detailed',
        includeCharts: true
      };

      const result = await exampleAnalysisOperation(input);

      expect(result).toHaveProperty('charts');
      expect(result.charts).toBeInstanceOf(Array);
      expect(result.charts!.length).toBeGreaterThan(0);
      
      result.charts!.forEach(chart => {
        expect(chart).toHaveProperty('type');
        expect(chart).toHaveProperty('data');
      });
    });

    it('should respect time range filter', async () => {
      const input: AnalysisOperationInput = {
        analysisType: 'trends',
        timeRange: {
          start: '2024-01-01',
          end: '2024-12-31'
        },
        includeCharts: false
      };

      const result = await exampleAnalysisOperation(input);

      expect(result).toHaveProperty('timeRange');
      expect(result.timeRange).toEqual(input.timeRange);
    });

    it('should handle different analysis types', async () => {
      const analysisTypes = ['summary', 'trends', 'patterns', 'detailed'] as const;

      for (const analysisType of analysisTypes) {
        const input: AnalysisOperationInput = {
          analysisType,
          includeCharts: false
        };

        const result = await exampleAnalysisOperation(input);
        expect(result.analysisType).toBe(analysisType);
      }
    });
  });

  describe('Tool Performance', () => {
    it('should complete data operation within reasonable time', async () => {
      const startTime = Date.now();
      
      await exampleDataOperation({
        limit: 10,
        includeMetadata: true
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within 1 second (accounting for 100ms simulated delay)
      expect(duration).toBeLessThan(1000);
    });

    it('should complete search operation within reasonable time', async () => {
      const startTime = Date.now();
      
      await exampleSearchOperation({
        query: 'test',
        searchType: 'exact',
        maxResults: 10
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within 1 second (accounting for 150ms simulated delay)
      expect(duration).toBeLessThan(1000);
    });

    it('should complete analysis operation within reasonable time', async () => {
      const startTime = Date.now();
      
      await exampleAnalysisOperation({
        analysisType: 'summary',
        includeCharts: true
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within 1 second (accounting for 200ms simulated delay)
      expect(duration).toBeLessThan(1000);
    });
  });
});