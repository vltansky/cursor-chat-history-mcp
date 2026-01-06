import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listConversations,
  getConversation,
  getConversationSummary,
  searchConversations,
  getBubbleMessage,
  getRecentConversations,
  getConversationsByProject
} from './conversation-tools.js';
import { CursorDatabaseReader } from '../database/reader.js';
import * as databaseUtils from '../utils/database-utils.js';

// Mock the database reader
vi.mock('../database/reader.js');
vi.mock('../utils/database-utils.js');

const mockDatabaseReader = vi.mocked(CursorDatabaseReader);
const mockDetectCursorDatabasePath = vi.mocked(databaseUtils.detectCursorDatabasePath);

describe('Conversation Tools', () => {
  let mockReader: any;

  beforeEach(() => {
    mockReader = {
      connect: vi.fn(),
      close: vi.fn(),
      getConversationIds: vi.fn(),
      getConversationSummary: vi.fn(),
      getConversationById: vi.fn(),
      getBubbleMessage: vi.fn(),
      searchConversations: vi.fn(),
      searchConversationsEnhanced: vi.fn(),
      getConversationIdsByProject: vi.fn()
    };

    mockDatabaseReader.mockImplementation(() => mockReader);
    mockDetectCursorDatabasePath.mockReturnValue('/mock/path/to/cursor.db');

    // Clear environment variable
    delete process.env.CURSOR_DB_PATH;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('listConversations', () => {
    it('should list conversations with default parameters', async () => {
      const mockConversationIds = ['conv1', 'conv2'];
      const mockSummary = {
        composerId: 'conv1',
        format: 'legacy' as const,
        messageCount: 5,
        hasCodeBlocks: true,
        relevantFiles: ['file1.ts'],
        attachedFolders: ['folder1'],
        firstMessage: 'Hello world',
        conversationSize: 1000
      };

      mockReader.getConversationIds.mockResolvedValue(mockConversationIds);
      mockReader.getConversationSummary.mockResolvedValue(mockSummary);

      const result = await listConversations({});

      expect(mockReader.connect).toHaveBeenCalled();
      expect(mockReader.close).toHaveBeenCalled();
      expect(result.conversations).toHaveLength(2);
      expect(result.totalFound).toBe(2);
      expect(result.filters.limit).toBe(10); // Default limit is 10
      expect(result.filters.minLength).toBe(100);
    });

    it('should handle empty results', async () => {
      mockReader.getConversationIds.mockResolvedValue([]);

      const result = await listConversations({});

      expect(result.conversations).toHaveLength(0);
      expect(result.totalFound).toBe(0);
    });

    it('should always close database connection', async () => {
      mockReader.getConversationIds.mockRejectedValue(new Error('Database error'));

      await expect(listConversations({})).rejects.toThrow('Database error');
      expect(mockReader.close).toHaveBeenCalled();
    });
  });

  describe('getConversation', () => {
    it('should get conversation summary when summaryOnly is true', async () => {
      const mockSummary = {
        composerId: 'conv1',
        format: 'legacy' as const,
        messageCount: 1,
        title: 'Test Conversation',
        aiGeneratedSummary: 'A test summary',
        relevantFiles: ['file1.ts'],
        attachedFolders: ['folder1'],
        conversationSize: 1000
      };

      mockReader.getConversationSummary.mockResolvedValue(mockSummary);

      const result = await getConversation({
        conversationId: 'conv1',
        summaryOnly: true
      });

      expect(mockReader.connect).toHaveBeenCalled();
      expect(mockReader.getConversationSummary).toHaveBeenCalled();
      expect(result.conversation).toBeDefined();
      expect(result.conversation!.format).toBe('legacy');
      expect(result.conversation!.messageCount).toBe(1);
    });

    it('should return null for non-existent conversation', async () => {
      mockReader.getConversationSummary.mockResolvedValue(null);

      const result = await getConversation({
        conversationId: 'nonexistent',
        summaryOnly: true
      });

      expect(result.conversation).toBeNull();
    });
  });

  describe('getConversationSummary', () => {
    it('should get conversation summary', async () => {
      const mockSummary = {
        composerId: 'conv1',
        format: 'legacy' as const,
        messageCount: 5,
        hasCodeBlocks: true,
        codeBlockCount: 3,
        conversationSize: 2000,
        firstMessage: 'First message',
        relevantFiles: ['file1.ts'],
        attachedFolders: ['src']
      };

      mockReader.getConversationSummary.mockResolvedValue(mockSummary);

      const result = await getConversationSummary({
        conversationId: 'conv1'
      });

      expect(result.summary).toEqual(mockSummary);
    });

    it('should return null for non-existent conversation', async () => {
      mockReader.getConversationSummary.mockResolvedValue(null);

      const result = await getConversationSummary({
        conversationId: 'nonexistent'
      });

      expect(result.summary).toBeNull();
    });
  });

  describe('searchConversations', () => {
    it('should search conversations with default options', async () => {
      const mockResults = [
        {
          composerId: 'conv1',
          format: 'legacy' as const,
          matches: [
            {
              text: 'Found text with query match',
              context: 'Context around match',
              bubbleId: 'bubble1',
              type: 1
            }
          ],
          totalMatches: 1,
          messageCount: 5,
          hasCodeBlocks: true,
          relevantFiles: ['file1.ts'],
          attachedFolders: ['src']
        }
      ];

      mockReader.searchConversationsEnhanced.mockResolvedValue(mockResults);

      const result = await searchConversations({
        query: 'test query'
      });

      expect(mockReader.searchConversationsEnhanced).toHaveBeenCalled();
      expect(result.conversations).toBeDefined();
      expect(result.query).toBe('test query');
    });
  });

  describe('getBubbleMessage', () => {
    it('should get bubble message', async () => {
      const mockBubbleMessage = {
        bubbleId: 'bubble1',
        type: 1,
        text: 'Bubble message text',
        relevantFiles: ['file1.ts'],
        suggestedCodeBlocks: [],
        attachedFoldersNew: []
      };

      mockReader.getBubbleMessage.mockResolvedValue(mockBubbleMessage);

      const result = await getBubbleMessage({
        composerId: 'conv1',
        bubbleId: 'bubble1'
      });

      expect(result.bubbleMessage).toEqual(mockBubbleMessage);
    });

    it('should return null for non-existent bubble message', async () => {
      mockReader.getBubbleMessage.mockResolvedValue(null);

      const result = await getBubbleMessage({
        composerId: 'conv1',
        bubbleId: 'nonexistent'
      });

      expect(result.bubbleMessage).toBeNull();
    });
  });

  describe('getRecentConversations', () => {
    it('should get recent conversations', async () => {
      const mockConversationIds = ['conv1', 'conv2'];
      const mockSummary = {
        composerId: 'conv1',
        format: 'legacy' as const,
        messageCount: 3,
        hasCodeBlocks: false,
        relevantFiles: [],
        attachedFolders: [],
        conversationSize: 800
      };

      mockReader.getConversationIds.mockResolvedValue(mockConversationIds);
      mockReader.getConversationSummary.mockResolvedValue(mockSummary);

      const result = await getRecentConversations({});

      expect(result.conversations).toHaveLength(2);
      expect(result.requestedLimit).toBe(10);
      expect(result.totalFound).toBe(2);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('getConversationsByProject', () => {
    it('should get conversations by project path', async () => {
      const mockResults = [
        { composerId: 'conv1', relevanceScore: 0.9 }
      ];

      const mockSummary = {
        composerId: 'conv1',
        format: 'legacy' as const,
        messageCount: 5,
        hasCodeBlocks: true,
        relevantFiles: ['src/file1.ts'],
        attachedFolders: ['/project/src'],
        conversationSize: 1500
      };

      mockReader.getConversationIdsByProject.mockResolvedValue(mockResults);
      mockReader.getConversationSummary.mockResolvedValue(mockSummary);

      const result = await getConversationsByProject({
        projectPath: '/project/src'
      });

      expect(result.conversations).toHaveLength(1);
      expect(result.totalFound).toBe(1);
      expect(result.filters.projectPath).toBe('/project/src');
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      mockReader.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(listConversations({})).rejects.toThrow('Connection failed');
      expect(mockReader.close).toHaveBeenCalled();
    });

    it('should handle validation errors', async () => {
      const invalidInput = { conversationId: '' };

      await expect(getConversation(invalidInput as any)).rejects.toThrow();
    });
  });
});