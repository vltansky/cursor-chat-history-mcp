import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir, platform } from 'os';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import {
  detectOperatingSystem,
  getDefaultDatabasePath,
  verifyDatabasePath,
  getUserConfiguredDatabasePath,
  detectDatabasePath,
  detectCursorDatabasePath,
  validateDatabasePath,
  createDefaultDatabaseConfig,
  getCursorDatabasePaths
} from './database-utils.js';

// Mock the os module
vi.mock('os', () => ({
  platform: vi.fn(),
  homedir: vi.fn()
}));

// Mock the fs module
vi.mock('fs', () => ({
  existsSync: vi.fn()
}));

// Mock console methods to avoid noise in tests
vi.mock('console', () => ({
  warn: vi.fn(),
  log: vi.fn()
}));

const mockPlatform = vi.mocked(platform);
const mockHomedir = vi.mocked(homedir);
const mockExistsSync = vi.mocked(existsSync);

describe('Database Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHomedir.mockReturnValue('/home/testuser');
    delete process.env.CURSOR_DB_PATH;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectOperatingSystem', () => {
    it('should detect macOS correctly', () => {
      mockPlatform.mockReturnValue('darwin');
      expect(detectOperatingSystem()).toBe('macOS');
    });

    it('should detect Windows correctly', () => {
      mockPlatform.mockReturnValue('win32');
      expect(detectOperatingSystem()).toBe('windows');
    });

    it('should detect Linux correctly', () => {
      mockPlatform.mockReturnValue('linux');
      expect(detectOperatingSystem()).toBe('linux');
    });

    it('should return unknown for unrecognized platforms', () => {
      mockPlatform.mockReturnValue('freebsd');
      expect(detectOperatingSystem()).toBe('unknown');
    });
  });

  describe('getDefaultDatabasePath', () => {
    beforeEach(() => {
      mockHomedir.mockReturnValue('/home/testuser');
    });

    it('should return macOS path for macOS', () => {
      const expected = join('/home/testuser', 'Library/Application Support/Cursor/User/globalStorage/state.vscdb');
      expect(getDefaultDatabasePath('macOS')).toBe(expected);
      expect(getDefaultDatabasePath('darwin')).toBe(expected);
    });

    it('should return Windows path for Windows', () => {
      const expected = join('/home/testuser', 'AppData/Roaming/Cursor/User/globalStorage/state.vscdb');
      expect(getDefaultDatabasePath('windows')).toBe(expected);
      expect(getDefaultDatabasePath('win32')).toBe(expected);
    });

    it('should return Linux path for Linux', () => {
      const expected = join('/home/testuser', '.config/Cursor/User/globalStorage/state.vscdb');
      expect(getDefaultDatabasePath('linux')).toBe(expected);
    });

    it('should fallback to Linux path for unknown OS', () => {
      const expected = join('/home/testuser', '.config/Cursor/User/globalStorage/state.vscdb');
      expect(getDefaultDatabasePath('unknown')).toBe(expected);
    });
  });

  describe('verifyDatabasePath', () => {
    it('should return exists: false for empty path', () => {
      const result = verifyDatabasePath('');
      expect(result.exists).toBe(false);
      expect(result.error).toBe('Database path is empty');
    });

    it('should return exists: true when file exists', () => {
      mockExistsSync.mockReturnValue(true);
      const result = verifyDatabasePath('/path/to/db.vscdb');
      expect(result.exists).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return exists: false when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = verifyDatabasePath('/path/to/nonexistent.vscdb');
      expect(result.exists).toBe(false);
      expect(result.error).toContain('Database file not found');
    });

    it('should handle file system errors gracefully', () => {
      mockExistsSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const result = verifyDatabasePath('/path/to/db.vscdb');
      expect(result.exists).toBe(false);
      expect(result.error).toContain('Error verifying database path: Permission denied');
    });
  });

  describe('getUserConfiguredDatabasePath', () => {
    it('should return null when no environment variable is set', () => {
      expect(getUserConfiguredDatabasePath()).toBeNull();
    });

    it('should return resolved path when environment variable is set and file exists', () => {
      process.env.CURSOR_DB_PATH = '~/custom/path/db.vscdb';
      mockHomedir.mockReturnValue('/home/testuser');
      mockExistsSync.mockReturnValue(true);

      const result = getUserConfiguredDatabasePath();
      expect(result).toBe(resolve('/home/testuser/custom/path/db.vscdb'));
    });

    it('should return null when environment variable is set but file does not exist', () => {
      process.env.CURSOR_DB_PATH = '~/custom/path/nonexistent.vscdb';
      mockHomedir.mockReturnValue('/home/testuser');
      mockExistsSync.mockReturnValue(false);

      const result = getUserConfiguredDatabasePath();
      expect(result).toBeNull();
    });

    it('should handle absolute paths correctly', () => {
      process.env.CURSOR_DB_PATH = '/absolute/path/db.vscdb';
      mockExistsSync.mockReturnValue(true);

      const result = getUserConfiguredDatabasePath();
      expect(result).toBe(resolve('/absolute/path/db.vscdb'));
    });
  });

  describe('detectDatabasePath', () => {
    beforeEach(() => {
      mockHomedir.mockReturnValue('/home/testuser');
      mockPlatform.mockReturnValue('linux');
    });

    it('should return user-configured path when available', () => {
      process.env.CURSOR_DB_PATH = '/custom/path/db.vscdb';
      mockExistsSync.mockReturnValue(true);

      const result = detectDatabasePath();
      expect(result).toBe(resolve('/custom/path/db.vscdb'));
    });

    it('should return default path when user config is not available but default exists', () => {
      mockExistsSync.mockReturnValue(true);

      const result = detectDatabasePath();
      const expectedPath = resolve(join('/home/testuser', '.config/Cursor/User/globalStorage/state.vscdb'));
      expect(result).toBe(expectedPath);
    });

    it('should try fallback paths when default does not exist', () => {
      // First call (default path) returns false, second call (fallback) returns true
      mockExistsSync
        .mockReturnValueOnce(false) // Default path doesn't exist
        .mockReturnValueOnce(true); // First fallback exists

      const result = detectDatabasePath();
      // Should find the first fallback path
      expect(result).toBeDefined();
      expect(mockExistsSync).toHaveBeenCalledTimes(2);
    });

    it('should throw error when no valid path is found', () => {
      mockExistsSync.mockReturnValue(false); // All paths fail

      expect(() => detectDatabasePath()).toThrow('Unable to locate Cursor database file');
    });

    it('should work correctly for macOS', () => {
      mockPlatform.mockReturnValue('darwin');
      mockExistsSync.mockReturnValue(true);

      const result = detectDatabasePath();
      const expectedPath = resolve(join('/home/testuser', 'Library/Application Support/Cursor/User/globalStorage/state.vscdb'));
      expect(result).toBe(expectedPath);
    });

    it('should work correctly for Windows', () => {
      mockPlatform.mockReturnValue('win32');
      mockExistsSync.mockReturnValue(true);

      const result = detectDatabasePath();
      const expectedPath = resolve(join('/home/testuser', 'AppData/Roaming/Cursor/User/globalStorage/state.vscdb'));
      expect(result).toBe(expectedPath);
    });
  });

  describe('validateDatabasePath (deprecated)', () => {
    it('should work as a wrapper around verifyDatabasePath', () => {
      mockExistsSync.mockReturnValue(true);
      const result = validateDatabasePath('/path/to/db.vscdb');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid for non-existent files', () => {
      mockExistsSync.mockReturnValue(false);
      const result = validateDatabasePath('/path/to/nonexistent.vscdb');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Database file not found');
    });
  });

  describe('detectCursorDatabasePath (deprecated)', () => {
    it('should work as a wrapper around detectDatabasePath', () => {
      mockPlatform.mockReturnValue('linux');
      mockHomedir.mockReturnValue('/home/testuser');
      mockExistsSync.mockReturnValue(true);

      const result = detectCursorDatabasePath();
      const expectedPath = resolve(join('/home/testuser', '.config/Cursor/User/globalStorage/state.vscdb'));
      expect(result).toBe(expectedPath);
    });
  });

  describe('createDefaultDatabaseConfig', () => {
    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
      mockHomedir.mockReturnValue('/home/testuser');
      mockExistsSync.mockReturnValue(true);
    });

    it('should use custom path when provided', () => {
      const customPath = '/custom/path/db.vscdb';
      const config = createDefaultDatabaseConfig(customPath);

      expect(config.dbPath).toBe(customPath);
      expect(config.maxConversations).toBe(1000);
      expect(config.cacheEnabled).toBe(true);
      expect(config.minConversationSize).toBe(100); // Reduced to capture more conversations
      expect(config.resolveBubblesAutomatically).toBe(true);
    });

    it('should detect path automatically when no custom path provided', () => {
      const config = createDefaultDatabaseConfig();

      const expectedPath = resolve(join('/home/testuser', '.config/Cursor/User/globalStorage/state.vscdb'));
      expect(config.dbPath).toBe(expectedPath);
    });
  });

    describe('getCursorDatabasePaths function', () => {
    it('should return correct paths for all platforms', () => {
      // Mock homedir for consistent testing
      mockHomedir.mockReturnValue('/home/testuser');

      const paths = getCursorDatabasePaths();
      expect(paths.macOS).toBe(
        join('/home/testuser', 'Library/Application Support/Cursor/User/globalStorage/state.vscdb')
      );
      expect(paths.windows).toBe(
        join('/home/testuser', 'AppData/Roaming/Cursor/User/globalStorage/state.vscdb')
      );
      expect(paths.linux).toBe(
        join('/home/testuser', '.config/Cursor/User/globalStorage/state.vscdb')
      );
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle null/undefined paths gracefully', () => {
      const result = verifyDatabasePath(null as any);
      expect(result.exists).toBe(false);
      expect(result.error).toContain('Database path is empty');
    });

    it('should handle environment variable with tilde expansion', () => {
      process.env.CURSOR_DB_PATH = '~/Documents/cursor.db';
      mockHomedir.mockReturnValue('/Users/testuser');
      mockExistsSync.mockReturnValue(true);

      const result = getUserConfiguredDatabasePath();
      expect(result).toBe(resolve('/Users/testuser/Documents/cursor.db'));
    });

    it('should handle unknown operating systems with fallback', () => {
      mockPlatform.mockReturnValue('aix');
      mockHomedir.mockReturnValue('/home/testuser');
      mockExistsSync.mockReturnValue(true);

      const result = detectDatabasePath();
      // Should fallback to Linux-style path
      const expectedPath = resolve(join('/home/testuser', '.config/Cursor/User/globalStorage/state.vscdb'));
      expect(result).toBe(expectedPath);
    });
  });
});