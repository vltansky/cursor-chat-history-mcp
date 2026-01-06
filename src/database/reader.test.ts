import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CursorDatabaseReader } from './reader.js';
import Database from 'better-sqlite3';

// Mock better-sqlite3
vi.mock('better-sqlite3');

const mockDatabase = vi.mocked(Database);

describe('CursorDatabaseReader', () => {
  let mockDb: any;
  let reader: CursorDatabaseReader;
  let mockStmt: any;

  beforeEach(() => {
    // Create a reusable mock statement with get and all methods
    mockStmt = {
      get: vi.fn().mockReturnValue({ count: 10 }),
      all: vi.fn().mockReturnValue([])
    };

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      close: vi.fn(),
      exec: vi.fn()
    };

    mockDatabase.mockReturnValue(mockDb);

    reader = new CursorDatabaseReader({
      dbPath: '/test/path/cursor.db',
      minConversationSize: 1000
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create reader with default options', () => {
      const defaultReader = new CursorDatabaseReader({ dbPath: '/test/cursor.db' });
      expect(defaultReader).toBeDefined();
    });

    it('should create reader with custom options', () => {
      const customReader = new CursorDatabaseReader({
        dbPath: '/custom/path.db',
        minConversationSize: 5000,
        cacheEnabled: false
      });
      expect(customReader).toBeDefined();
    });
  });

  describe('connect', () => {
    it('should connect to database successfully', async () => {
      await reader.connect();

      expect(mockDatabase).toHaveBeenCalledWith('/test/path/cursor.db', { readonly: true });
      // The reader sets up WAL mode and tests a query
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      mockDatabase.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      await expect(reader.connect()).rejects.toThrow('Database connection failed');
    });

    it('should handle connection with cache disabled', async () => {
      const noCacheReader = new CursorDatabaseReader({
        dbPath: '/test/cursor.db',
        cacheEnabled: false
      });

      await noCacheReader.connect();

      expect(mockDatabase).toHaveBeenCalledWith('/test/cursor.db', { readonly: true });
    });
  });

  describe('close', () => {
    it('should close database connection', () => {
      reader['db'] = mockDb;
      reader.close();

      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should handle close when not connected', () => {
      expect(() => reader.close()).not.toThrow();
    });
  });

  describe('getConversationIds', () => {
    beforeEach(async () => {
      await reader.connect();
    });

    it('should get conversation IDs with default filters', async () => {
      // Mock returning composerData keys
      mockStmt.all.mockReturnValue([
        { key: 'composerData:conv1' },
        { key: 'composerData:conv2' }
      ]);

      const result = await reader.getConversationIds({});

      expect(result).toEqual(['conv1', 'conv2']);
    });

    it('should apply minLength filter', async () => {
      mockStmt.all.mockReturnValue([{ key: 'composerData:conv1' }]);

      const result = await reader.getConversationIds({ minLength: 2000 });

      expect(result).toEqual(['conv1']);
    });

    it('should apply keywords filter', async () => {
      mockStmt.all.mockReturnValue([{ key: 'composerData:conv1' }]);

      const result = await reader.getConversationIds({ keywords: ['test', 'query'] });

      expect(result).toEqual(['conv1']);
    });

    it('should apply format filter', async () => {
      mockStmt.all.mockReturnValue([{ key: 'composerData:conv1' }]);

      const result = await reader.getConversationIds({ format: 'modern' });

      expect(result).toEqual(['conv1']);
    });
  });

  describe('getConversationById', () => {
    beforeEach(async () => {
      await reader.connect();
    });

    it('should get conversation by ID', async () => {
      const mockConversation = {
        composerId: 'conv1',
        text: 'conversation text',
        conversation: [{ type: 1, text: 'hello' }]
      };

      mockStmt.get.mockReturnValue({
        value: JSON.stringify(mockConversation)
      });

      const result = await reader.getConversationById('conv1');

      expect(result).toBeDefined();
      expect(result?.composerId).toBe('conv1');
    });

    it('should return null for non-existent conversation', async () => {
      mockStmt.get.mockReturnValue(undefined);

      const result = await reader.getConversationById('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle JSON parsing errors gracefully', async () => {
      mockStmt.get.mockReturnValue({
        value: 'invalid json'
      });

      await expect(reader.getConversationById('conv1')).rejects.toThrow();
    });
  });

  describe('getConversationSummary', () => {
    beforeEach(async () => {
      await reader.connect();
    });

    it('should get conversation summary with default options', async () => {
      const mockConversation = {
        composerId: 'conv1',
        text: 'stored summary',
        richText: 'rich text',
        conversation: [
          { type: 1, text: 'first message' },
          { type: 2, text: 'second message' }
        ]
      };

      mockStmt.get.mockReturnValue({
        value: JSON.stringify(mockConversation)
      });

      const result = await reader.getConversationSummary('conv1');

      expect(result).toBeDefined();
      expect(result?.composerId).toBe('conv1');
      expect(result?.format).toBe('legacy');
      expect(result?.messageCount).toBe(2);
    });

    it('should include first message when requested', async () => {
      const mockConversation = {
        composerId: 'conv1',
        conversation: [
          { type: 1, text: 'This is the first message' }
        ]
      };

      mockStmt.get.mockReturnValue({
        value: JSON.stringify(mockConversation)
      });

      const result = await reader.getConversationSummary('conv1', {
        includeFirstMessage: true,
        maxFirstMessageLength: 50
      });

      expect(result?.firstMessage).toBe('This is the first message');
    });

    it('should detect code blocks', async () => {
      const mockConversation = {
        composerId: 'conv1',
        conversation: [
          {
            type: 1,
            text: 'message',
            suggestedCodeBlocks: [{ language: 'js', code: 'console.log()' }]
          }
        ]
      };

      mockStmt.get.mockReturnValue({
        value: JSON.stringify(mockConversation)
      });

      const result = await reader.getConversationSummary('conv1', {
        includeCodeBlockCount: true
      });

      expect(result?.hasCodeBlocks).toBe(true);
      expect(result?.codeBlockCount).toBe(1);
    });

    it('should return null for non-existent conversation', async () => {
      mockStmt.get.mockReturnValue(undefined);

      const result = await reader.getConversationSummary('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getBubbleMessage', () => {
    beforeEach(async () => {
      await reader.connect();
    });

    it('should get bubble message', async () => {
      const mockBubble = {
        bubbleId: 'bubble1',
        type: 1,
        text: 'bubble text',
        relevantFiles: ['file1.ts'],
        suggestedCodeBlocks: [],
        attachedFoldersNew: ['folder1']
      };

      mockStmt.get.mockReturnValue({
        value: JSON.stringify(mockBubble)
      });

      const result = await reader.getBubbleMessage('conv1', 'bubble1');

      expect(result).toBeDefined();
      expect(result?.bubbleId).toBe('bubble1');
      expect(result?.type).toBe(1);
      expect(result?.text).toBe('bubble text');
    });

    it('should return null for non-existent bubble', async () => {
      mockStmt.get.mockReturnValue(undefined);

      const result = await reader.getBubbleMessage('conv1', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('searchConversations', () => {
    beforeEach(async () => {
      await reader.connect();
    });

    it('should search conversations', async () => {
      const mockConversation = {
        composerId: 'conv1',
        text: 'conversation with search term',
        conversation: [
          { type: 1, text: 'message with search term' }
        ]
      };

      mockStmt.all.mockReturnValue([
        { key: 'composerData:conv1', value: JSON.stringify(mockConversation) }
      ]);

      const result = await reader.searchConversations('search term');

      expect(result).toHaveLength(1);
      expect(result[0].composerId).toBe('conv1');
    });

    it('should apply search options', async () => {
      mockStmt.all.mockReturnValue([]);

      await reader.searchConversations('query', {
        maxResults: 5,
        searchType: 'code',
        format: 'modern'
      });

      // Just verify it doesn't throw with these options
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('getConversationIdsByProject', () => {
    beforeEach(async () => {
      await reader.connect();
    });

    it('should get conversations by project path', async () => {
      const mockConversation = {
        composerId: 'conv1',
        conversation: [
          { type: 1, text: 'test', attachedFoldersNew: ['/project/path'] }
        ]
      };

      mockStmt.all.mockReturnValue([
        { key: 'composerData:conv1', value: JSON.stringify(mockConversation) }
      ]);

      const result = await reader.getConversationIdsByProject('/project/path');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should apply project search options', async () => {
      mockStmt.all.mockReturnValue([]);

      await reader.getConversationIdsByProject('/project', {
        filePattern: '*.ts',
        limit: 10,
        orderBy: 'relevance'
      });

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      await reader.connect();

      // Now make the mock throw for subsequent calls
      mockStmt.get.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(reader.getConversationById('conv1')).rejects.toThrow();
    });

    it('should handle missing database connection', async () => {
      const unconnectedReader = new CursorDatabaseReader({ dbPath: '/test/cursor.db' });

      await expect(unconnectedReader.getConversationIds({})).rejects.toThrow();
    });
  });
});
