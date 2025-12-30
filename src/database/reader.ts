import Database from 'better-sqlite3';
import type {
  CursorConversation,
  LegacyCursorConversation,
  ModernCursorConversation,
  BubbleMessage,
  ConversationSummary,
  ConversationSearchResult,
  ConversationStats,
  ConversationFilters,
  SummaryOptions,
  DatabaseConfig,
  SearchMatch
} from './types.js';
import {
  isLegacyConversation,
  isModernConversation
} from './types.js';
import {
  createDefaultDatabaseConfig,
  extractComposerIdFromKey,
  generateBubbleIdKey,
  sanitizeMinConversationSize,
  sanitizeLimit,
  createFilePatternLike,
  sanitizeSearchQuery
} from '../utils/database-utils.js';
import {
  DatabaseError,
  DatabaseConnectionError,
  ConversationNotFoundError,
  BubbleMessageNotFoundError,
  ConversationParseError,
  SearchError,
  ValidationError
} from '../utils/errors.js';

export class CursorDatabaseReader {
  private db: Database.Database | null = null;
  private config: DatabaseConfig;
  private cache: Map<string, any> = new Map();

  constructor(config?: Partial<DatabaseConfig>) {
    this.config = { ...createDefaultDatabaseConfig(), ...config };
  }

  /**
   * Initialize database connection
   */
  async connect(): Promise<void> {
    if (this.db) {
      return;
    }

    try {
      this.db = new Database(this.config.dbPath, { readonly: true });

      const testQuery = this.db.prepare('SELECT COUNT(*) as count FROM cursorDiskKV LIMIT 1');
      testQuery.get();
    } catch (error) {
      throw new DatabaseConnectionError(
        this.config.dbPath,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.cache.clear();
  }

  /**
   * Ensure database is connected
   */
  private ensureConnected(): void {
    if (!this.db) {
      throw new DatabaseError('Database not connected. Call connect() first.');
    }
  }

  /**
   * Get conversation IDs with optional filters (ordered by recency using ROWID)
   */
  async getConversationIds(filters?: ConversationFilters): Promise<string[]> {
    this.ensureConnected();

    try {
      const minLength = sanitizeMinConversationSize(filters?.minLength);
      const limit = sanitizeLimit(undefined, this.config.maxConversations);

      let whereConditions: string[] = [];
      let params: any[] = [];

      whereConditions.push("key LIKE 'composerData:%'");
      whereConditions.push('length(value) > ?');
      params.push(this.config.minConversationSize || 100);

      if (filters?.format && filters.format !== 'both') {
        if (filters.format === 'legacy') {
          whereConditions.push("value NOT LIKE '%\"_v\":%'");
        } else if (filters.format === 'modern') {
          whereConditions.push("value LIKE '%\"_v\":%'");
        }
      }

      if (filters?.projectPath) {
        // Check if it's a full path or just a project name
        const isFullPath = filters.projectPath.startsWith('/');

        if (isFullPath) {
          // For full paths, search in all three places
          whereConditions.push("(value LIKE ? OR value LIKE ? OR value LIKE ?)");
          params.push(`%"attachedFoldersNew":[%"${filters.projectPath}%`);
          params.push(`%"relevantFiles":[%"${filters.projectPath}%`);
          params.push(`%"fsPath":"${filters.projectPath}%`);
        } else {
          // For project names, we need to search for the project name in paths
          whereConditions.push("(value LIKE ? OR value LIKE ? OR value LIKE ?)");
          params.push(`%"attachedFoldersNew":[%"${filters.projectPath}%`);
          params.push(`%"relevantFiles":[%"${filters.projectPath}%`);
          params.push(`%"fsPath":"%/${filters.projectPath}/%`);
        }
      }

      if (filters?.filePattern) {
        whereConditions.push("value LIKE ?");
        params.push(`%"relevantFiles":[%"${filters.filePattern}%`);
      }

      if (filters?.relevantFiles && filters.relevantFiles.length > 0) {
        const fileConditions = filters.relevantFiles.map(() => "value LIKE ?");
        whereConditions.push(`(${fileConditions.join(' OR ')})`);
        filters.relevantFiles.forEach(file => {
          params.push(`%"relevantFiles":[%"${file}"%`);
        });
      }

      if (filters?.hasCodeBlocks) {
        whereConditions.push("value LIKE '%\"suggestedCodeBlocks\":[%'");
      }

      if (filters?.keywords && filters.keywords.length > 0) {
        const keywordConditions = filters.keywords.map(() => "value LIKE ?");
        whereConditions.push(`(${keywordConditions.join(' OR ')})`);
        filters.keywords.forEach(keyword => {
          params.push(`%${keyword}%`);
        });
      }

      const sql = `
        SELECT key FROM cursorDiskKV
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY ROWID DESC
        LIMIT ?
      `;
      params.push(limit);

      const stmt = this.db!.prepare(sql);
      const rows = stmt.all(...params) as Array<{ key: string }>;

      return rows.map(row => extractComposerIdFromKey(row.key)).filter(Boolean) as string[];
    } catch (error) {
      throw new DatabaseError(`Failed to get conversation IDs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get conversation IDs filtered by project path with more precise JSON querying
   */
  async getConversationIdsByProject(
    projectPath: string,
    options?: {
      filePattern?: string;
      exactFilePath?: string;
      orderBy?: 'recency' | 'relevance';
      limit?: number;
      format?: 'legacy' | 'modern' | 'both';
      fuzzyMatch?: boolean;
    }
  ): Promise<Array<{ composerId: string; relevanceScore?: number }>> {
    this.ensureConnected();

    const limit = sanitizeLimit(options?.limit, 1000);
    const orderBy = options?.orderBy || 'recency';
    const fuzzyMatch = options?.fuzzyMatch ?? false;

    let sql = `
      SELECT key, value FROM cursorDiskKV
      WHERE key LIKE 'composerData:%'
      AND length(value) > ?
    `;

    const params: any[] = [this.config.minConversationSize || 5000];

    if (options?.format && options.format !== 'both') {
      if (options.format === 'legacy') {
        sql += ` AND value NOT LIKE '%"_v":%'`;
      } else if (options.format === 'modern') {
        sql += ` AND value LIKE '%"_v":%'`;
      }
    }

    if (fuzzyMatch) {
      sql += ` AND (
        (value LIKE '%"attachedFoldersNew":%' AND (
          value LIKE ? OR
          value LIKE ? OR
          value LIKE ?
        )) OR
        (value LIKE '%"context":%' AND value LIKE '%"fsPath":%' AND (
          value LIKE ? OR
          value LIKE ? OR
          value LIKE ?
        ))
      )`;

      const projectLower = projectPath.toLowerCase();
      const escapedProjectPath = projectPath.replace(/"/g, '\\"');
      const escapedProjectLower = projectLower.replace(/"/g, '\\"');

      // For attachedFoldersNew
      params.push(`%"${escapedProjectPath}"%`);
      params.push(`%"${escapedProjectLower}"%`);
      params.push(`%${escapedProjectPath}%`);

      // For context.fileSelections.uri.fsPath
      params.push(`%"fsPath":"%/${escapedProjectPath}/%`);
      params.push(`%"fsPath":"%/${escapedProjectLower}/%`);
      params.push(`%"fsPath":"%${escapedProjectPath}%`);
    } else {
      sql += ` AND (
        (value LIKE '%"attachedFoldersNew":%' AND (
          value LIKE ? OR
          value LIKE ?
        )) OR
        (value LIKE '%"context":%' AND value LIKE '%"fsPath":%' AND (
          value LIKE ? OR
          value LIKE ?
        ))
      )`;

      const escapedProjectPath = projectPath.replace(/"/g, '\\"');

      // For attachedFoldersNew
      params.push(`%"${escapedProjectPath}"%`);
      params.push(`%"${escapedProjectPath}/%"`);

      // For context.fileSelections.uri.fsPath
      params.push(`%"fsPath":"%/${escapedProjectPath}/%`);
      params.push(`%"fsPath":"%/${escapedProjectPath}/%`);
    }

    if (options?.filePattern) {
      const pattern = createFilePatternLike(options.filePattern);
      sql += ` AND value LIKE '%"relevantFiles":%' AND value LIKE ?`;
      params.push(`%${pattern}%`);
    }

    if (options?.exactFilePath) {
      const escapedFilePath = options.exactFilePath.replace(/"/g, '\\"');
      sql += ` AND value LIKE '%"relevantFiles":%' AND value LIKE ?`;
      params.push(`%"${escapedFilePath}"%`);
    }

    if (orderBy === 'recency') {
      sql += ` ORDER BY ROWID DESC`;
    } else {
      sql += ` ORDER BY ROWID DESC`;
    }

    sql += ` LIMIT ?`;
    params.push(limit);

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as Array<{ key: string; value: string }>;

    const results = rows.map(row => {
      const composerId = extractComposerIdFromKey(row.key);
      if (!composerId) return null;

      let relevanceScore = 1;

      if (orderBy === 'relevance') {
        try {
          const conversation = JSON.parse(row.value);
          relevanceScore = this.calculateProjectRelevanceScore(conversation, projectPath, options);
        } catch (error) {
          relevanceScore = 1;
        }
      }

      return {
        composerId,
        relevanceScore: orderBy === 'relevance' ? relevanceScore : undefined
      };
    }).filter(Boolean) as Array<{ composerId: string; relevanceScore?: number }>;

    if (orderBy === 'relevance') {
      results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    }

    return results;
  }

  /**
   * Extract project paths from conversation context field
   */
  private extractProjectPathsFromContext(conversation: any): string[] {
    const projectPaths = new Set<string>();

    // Check top-level context
    if (conversation.context?.fileSelections) {
      for (const selection of conversation.context.fileSelections) {
        const fsPath = selection.uri?.fsPath || selection.uri?.path;
        if (fsPath) {
          const projectName = this.extractProjectName(fsPath);
          if (projectName) {
            projectPaths.add(projectName);
            projectPaths.add(fsPath); // Also add full path for exact matching
          }
        }
      }
    }

    // Check message-level context for legacy format
    if (conversation.conversation && Array.isArray(conversation.conversation)) {
      for (const message of conversation.conversation) {
        if (message.context?.fileSelections) {
          for (const selection of message.context.fileSelections) {
            const fsPath = selection.uri?.fsPath || selection.uri?.path;
            if (fsPath) {
              const projectName = this.extractProjectName(fsPath);
              if (projectName) {
                projectPaths.add(projectName);
                projectPaths.add(fsPath); // Also add full path for exact matching
              }
            }
          }
        }
      }
    }

    return Array.from(projectPaths);
  }

    /**
   * Extract project name from file path
   */
  private extractProjectName(filePath: string): string {
    // Extract project name from path like "/Users/vladta/Projects/editor-elements/file.ts"
    const parts = filePath.split('/').filter(Boolean); // Remove empty parts

    // Look for "Projects" folder (case-insensitive)
    const projectsIndex = parts.findIndex(part => part.toLowerCase() === 'projects');
    if (projectsIndex >= 0 && projectsIndex < parts.length - 1) {
      return parts[projectsIndex + 1];
    }

    // Fallback: try to find common workspace patterns
    const workspacePatterns = ['workspace', 'repos', 'code', 'dev', 'development', 'src', 'work'];
    for (const pattern of workspacePatterns) {
      const patternIndex = parts.findIndex(part => part.toLowerCase() === pattern);
      if (patternIndex >= 0 && patternIndex < parts.length - 1) {
        return parts[patternIndex + 1];
      }
    }

    // For paths like /Users/username/project-name/..., take the project name
    // Skip common user directory patterns
    const skipPatterns = ['users', 'home', 'documents', 'desktop', 'downloads'];
    let candidateIndex = -1;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i].toLowerCase();
      if (!skipPatterns.includes(part) && part.length > 1) {
        // This could be a project name if it's not a common system directory
        candidateIndex = i;
        break;
      }
    }

    if (candidateIndex >= 0 && candidateIndex < parts.length - 1) {
      // Take the next part after the candidate (likely the project name)
      return parts[candidateIndex + 1];
    }

    // Last resort: if we have at least 3 parts, take the one that's most likely a project
    if (parts.length >= 3) {
      // Skip the first two parts (usually /Users/username) and take the third
      return parts[2] || '';
    }

    return '';
  }

  /**
   * Calculate relevance score for project-based filtering
   */
  private calculateProjectRelevanceScore(
    conversation: any,
    projectPath: string,
    options?: {
      filePattern?: string;
      exactFilePath?: string;
    }
  ): number {
    let score = 0;

    // NEW: Check context field for project paths (highest priority)
    const contextProjectPaths = this.extractProjectPathsFromContext(conversation);
    for (const contextPath of contextProjectPaths) {
      if (contextPath === projectPath) {
        score += 15; // Highest score for exact context match
      } else if (contextPath.includes(projectPath) || projectPath.includes(contextPath)) {
        score += 10; // High score for partial context match
      }
    }

    // Check attachedFoldersNew for exact matches and path prefixes
    if (conversation.attachedFoldersNew && Array.isArray(conversation.attachedFoldersNew)) {
      for (const folder of conversation.attachedFoldersNew) {
        if (typeof folder === 'string') {
          if (folder === projectPath) {
            score += 10; // Exact match
          } else if (folder.startsWith(projectPath + '/')) {
            score += 5; // Subfolder match
          } else if (projectPath.startsWith(folder + '/')) {
            score += 3; // Parent folder match
          }
        }
      }
    }

    // Check relevantFiles for matches
    if (conversation.relevantFiles && Array.isArray(conversation.relevantFiles)) {
      for (const file of conversation.relevantFiles) {
        if (typeof file === 'string') {
          if (options?.exactFilePath && file === options.exactFilePath) {
            score += 8; // Exact file match
          } else if (file.startsWith(projectPath + '/')) {
            score += 2; // File in project
          }

          // File pattern matching
          if (options?.filePattern) {
            const pattern = options.filePattern.replace(/\*/g, '.*').replace(/\?/g, '.');
            const regex = new RegExp(pattern);
            if (regex.test(file)) {
              score += 1;
            }
          }
        }
      }
    }

    // Check legacy conversation messages for attachedFoldersNew and relevantFiles
    if (conversation.conversation && Array.isArray(conversation.conversation)) {
      for (const message of conversation.conversation) {
        if (message.attachedFoldersNew && Array.isArray(message.attachedFoldersNew)) {
          for (const folder of message.attachedFoldersNew) {
            if (typeof folder === 'string' && folder.startsWith(projectPath)) {
              score += 1;
            }
          }
        }
        if (message.relevantFiles && Array.isArray(message.relevantFiles)) {
          for (const file of message.relevantFiles) {
            if (typeof file === 'string' && file.startsWith(projectPath + '/')) {
              score += 1;
            }
          }
        }
      }
    }

    return Math.max(score, 1); // Minimum score of 1
  }

  /**
   * Get conversation by ID (handles both legacy and modern formats)
   */
  async getConversationById(composerId: string): Promise<CursorConversation | null> {
    this.ensureConnected();

    try {
      const cacheKey = `conversation:${composerId}`;
      if (this.config.cacheEnabled && this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      const stmt = this.db!.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
      const row = stmt.get(`composerData:${composerId}`) as { value: string } | undefined;

      if (!row) {
        return null;
      }

      try {
        const conversation = JSON.parse(row.value) as CursorConversation;

        if (this.config.cacheEnabled) {
          this.cache.set(cacheKey, conversation);
        }

        return conversation;
      } catch (parseError) {
        throw new ConversationParseError(`Failed to parse conversation data`, composerId, parseError instanceof Error ? parseError : new Error(String(parseError)));
      }
    } catch (error) {
      if (error instanceof ConversationParseError) {
        throw error;
      }
      throw new DatabaseError(`Failed to get conversation ${composerId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get individual message by bubble ID (for modern format)
   */
  async getBubbleMessage(composerId: string, bubbleId: string): Promise<BubbleMessage | null> {
    this.ensureConnected();

    try {
      const cacheKey = `bubble:${composerId}:${bubbleId}`;
      if (this.config.cacheEnabled && this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      const key = generateBubbleIdKey(composerId, bubbleId);
      const stmt = this.db!.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
      const row = stmt.get(key) as { value: string } | undefined;

      if (!row) {
        return null;
      }

      try {
        const message = JSON.parse(row.value) as BubbleMessage;

        if (this.config.cacheEnabled) {
          this.cache.set(cacheKey, message);
        }

        return message;
      } catch (parseError) {
        throw new ConversationParseError(`Failed to parse bubble message data`, composerId, parseError instanceof Error ? parseError : new Error(String(parseError)));
      }
    } catch (error) {
      if (error instanceof ConversationParseError) {
        throw error;
      }
      throw new DatabaseError(`Failed to get bubble message ${bubbleId} from conversation ${composerId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get conversation summary without full content
   */
  async getConversationSummary(composerId: string, options?: SummaryOptions): Promise<ConversationSummary | null> {
    this.ensureConnected();

    const conversation = await this.getConversationById(composerId);
    if (!conversation) {
      return null;
    }

    const format = isModernConversation(conversation) ? 'modern' : 'legacy';
    let messageCount = 0;
    let hasCodeBlocks = false;
    let codeBlockCount = 0;
    const relevantFiles = new Set<string>();
    const attachedFolders = new Set<string>();
    let firstMessage: string | undefined;
    let lastMessage: string | undefined;
    const conversationSize = JSON.stringify(conversation).length;
    let title: string | undefined;
    let aiGeneratedSummary: string | undefined;

    if (format === 'legacy') {
      const legacyConvo = conversation as LegacyCursorConversation;
      messageCount = legacyConvo.conversation.length;
      legacyConvo.conversation.forEach((msg, index) => {
        if (msg.suggestedCodeBlocks && msg.suggestedCodeBlocks.length > 0) {
          hasCodeBlocks = true;
          codeBlockCount += msg.suggestedCodeBlocks.length;
        }
        msg.relevantFiles?.forEach(file => relevantFiles.add(file));
        msg.attachedFoldersNew?.forEach(folder => attachedFolders.add(folder));
        if (index === 0) {
          firstMessage = msg.text;
        }
        lastMessage = msg.text;
      });
    } else {
      const modernConvo = conversation as ModernCursorConversation;
      messageCount = modernConvo.fullConversationHeadersOnly.length;
      title = modernConvo.name;
      aiGeneratedSummary = modernConvo.latestConversationSummary?.summary?.summary;

      // For modern conversations, we need to resolve bubbles to get details
      // This can be slow, so we only do it if necessary based on options
      const needsBubbleResolution = options?.includeFirstMessage || options?.includeLastMessage || options?.includeCodeBlockCount || options?.includeFileList;

      if (needsBubbleResolution && this.config.resolveBubblesAutomatically) {
        for (const header of modernConvo.fullConversationHeadersOnly) {
          const bubble = await this.getBubbleMessage(composerId, header.bubbleId);
          if (bubble) {
            if (bubble.suggestedCodeBlocks && bubble.suggestedCodeBlocks.length > 0) {
              hasCodeBlocks = true;
              codeBlockCount += bubble.suggestedCodeBlocks.length;
            }
            bubble.relevantFiles?.forEach(file => relevantFiles.add(file));
            bubble.attachedFoldersNew?.forEach(folder => attachedFolders.add(folder));

            if (!firstMessage) {
              firstMessage = bubble.text;
            }
            lastMessage = bubble.text;
          }
        }
      }
    }

    // Truncate messages if requested
    if (options?.includeFirstMessage && firstMessage) {
      firstMessage = firstMessage.substring(0, options.maxFirstMessageLength || 150);
    } else {
      firstMessage = undefined;
    }

    if (options?.includeLastMessage && lastMessage) {
      lastMessage = lastMessage.substring(0, options.maxLastMessageLength || 150);
    } else {
      lastMessage = undefined;
    }

    const summary: ConversationSummary = {
      composerId,
      format,
      messageCount,
      hasCodeBlocks,
      codeBlockCount: options?.includeCodeBlockCount ? codeBlockCount : 0,
      relevantFiles: options?.includeFileList ? Array.from(relevantFiles) : [],
      attachedFolders: options?.includeAttachedFolders ? Array.from(attachedFolders) : [],
      firstMessage,
      lastMessage,
      storedSummary: options?.includeStoredSummary ? conversation.text : undefined,
      storedRichText: options?.includeStoredSummary ? conversation.richText : undefined,
      title: options?.includeTitle ? title : undefined,
      aiGeneratedSummary: options?.includeAIGeneratedSummary ? aiGeneratedSummary : undefined,
      conversationSize
    };

    return summary;
  }

  /**
   * Search conversations by content (original method)
   */
  async searchConversations(query: string, options?: {
    includeCode?: boolean;
    contextLines?: number;
    maxResults?: number;
    searchBubbles?: boolean;
    searchType?: 'all' | 'summarization' | 'code' | 'files';
    format?: 'legacy' | 'modern' | 'both';
  }): Promise<ConversationSearchResult[]> {
    this.ensureConnected();

    const sanitizedQuery = sanitizeSearchQuery(query);
    const maxResults = sanitizeLimit(options?.maxResults, 100);
    const format = options?.format || 'both';

    // Build search patterns based on search type
    let searchPatterns: string[] = [];

    switch (options?.searchType) {
      case 'summarization':
        searchPatterns = ['%summarization%', '%summarize%', '%summary%'];
        break;
      case 'code':
        searchPatterns = ['%suggestedCodeBlocks%', '%```%'];
        break;
      case 'files':
        searchPatterns = ['%relevantFiles%', '%attachedFoldersNew%'];
        break;
      default:
        searchPatterns = [`%${sanitizedQuery}%`];
    }

    let sql = `
      SELECT key, value FROM cursorDiskKV
      WHERE key LIKE 'composerData:%'
      AND length(value) > ?
      AND (${searchPatterns.map(() => 'value LIKE ?').join(' OR ')})
    `;

    const params: any[] = [
      this.config.minConversationSize || 5000,
      ...searchPatterns
    ];

    // Add format filter
    if (format === 'legacy') {
      sql += ` AND value NOT LIKE '%"_v":%'`;
    } else if (format === 'modern') {
      sql += ` AND value LIKE '%"_v":%'`;
    }

    sql += ` ORDER BY ROWID DESC LIMIT ?`;
    params.push(maxResults);

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as Array<{ key: string; value: string }>;

    const results: ConversationSearchResult[] = [];

    for (const row of rows) {
      const composerId = extractComposerIdFromKey(row.key);
      if (!composerId) continue;

      try {
        const conversation = JSON.parse(row.value) as CursorConversation;
        const conversationFormat = isLegacyConversation(conversation) ? 'legacy' : 'modern';
        const matches: SearchMatch[] = [];

        if (isLegacyConversation(conversation)) {
          // Search in legacy format messages
          conversation.conversation.forEach((message, index) => {
            if (message.text.toLowerCase().includes(sanitizedQuery.toLowerCase())) {
              matches.push({
                messageIndex: index,
                text: message.text,
                context: this.extractContext(message.text, sanitizedQuery, options?.contextLines || 3),
                type: message.type
              });
            }
          });
        } else if (isModernConversation(conversation) && options?.searchBubbles) {
          // Search in modern format bubble messages
          const headers = conversation.fullConversationHeadersOnly || [];

          for (let index = 0; index < headers.length; index++) {
            const header = headers[index];
            try {
              const bubbleMessage = await this.getBubbleMessage(composerId, header.bubbleId);
              if (bubbleMessage && bubbleMessage.text.toLowerCase().includes(sanitizedQuery.toLowerCase())) {
                matches.push({
                  messageIndex: index,
                  bubbleId: header.bubbleId,
                  text: bubbleMessage.text,
                  context: this.extractContext(bubbleMessage.text, sanitizedQuery, options?.contextLines || 3),
                  type: bubbleMessage.type
                });
              }
            } catch (error) {
              console.error(`Failed to resolve bubble ${header.bubbleId} during search:`, error);
            }
          }
        }

        if (matches.length > 0) {
          let relevantFiles: string[] = [];
          let attachedFolders: string[] = [];

          if (isLegacyConversation(conversation)) {
            for (const message of conversation.conversation) {
              if (message.relevantFiles) relevantFiles.push(...message.relevantFiles);
              if (message.attachedFoldersNew) attachedFolders.push(...message.attachedFoldersNew);
            }
          } else if (isModernConversation(conversation) && options?.searchBubbles) {
            // For modern format, collect files from bubble messages
            const headers = conversation.fullConversationHeadersOnly || [];
            for (const header of headers) {
              try {
                const bubbleMessage = await this.getBubbleMessage(composerId, header.bubbleId);
                if (bubbleMessage) {
                  if (bubbleMessage.relevantFiles) relevantFiles.push(...bubbleMessage.relevantFiles);
                  if (bubbleMessage.attachedFoldersNew) attachedFolders.push(...bubbleMessage.attachedFoldersNew);
                }
              } catch (error) {
                console.error(`Failed to resolve bubble ${header.bubbleId} for file extraction:`, error);
              }
            }
          }

          results.push({
            composerId,
            format: conversationFormat,
            matches,
            relevantFiles: Array.from(new Set(relevantFiles)),
            attachedFolders: Array.from(new Set(attachedFolders))
          });
        }
      } catch (error) {
        console.error(`Failed to parse conversation ${composerId} during search:`, error);
      }
    }

    return results;
  }

  /**
   * Enhanced search with multi-keyword and LIKE pattern support
   */
  async searchConversationsEnhanced(options: {
    query?: string;
    keywords?: string[];
    keywordOperator?: 'AND' | 'OR';
    likePattern?: string;
    startDate?: string;
    endDate?: string;
    includeCode?: boolean;
    contextLines?: number;
    maxResults?: number;
    searchBubbles?: boolean;
    searchType?: 'all' | 'summarization' | 'code' | 'files';
    format?: 'legacy' | 'modern' | 'both';
  }): Promise<ConversationSearchResult[]> {
    this.ensureConnected();

    const maxResults = sanitizeLimit(options?.maxResults, 100);
    const format = options?.format || 'both';

    // Build search conditions for SQL
    let searchConditions: string[] = [];
    let searchParams: any[] = [];

    // Handle simple query
    if (options.query) {
      const sanitizedQuery = sanitizeSearchQuery(options.query);

      switch (options?.searchType) {
        case 'summarization':
          searchConditions.push('(value LIKE ? OR value LIKE ? OR value LIKE ?)');
          searchParams.push('%summarization%', '%summarize%', '%summary%');
          break;
        case 'code':
          searchConditions.push('(value LIKE ? OR value LIKE ?)');
          searchParams.push('%suggestedCodeBlocks%', '%```%');
          break;
        case 'files':
          searchConditions.push('(value LIKE ? OR value LIKE ?)');
          searchParams.push('%relevantFiles%', '%attachedFoldersNew%');
          break;
        default:
          searchConditions.push('value LIKE ?');
          searchParams.push(`%${sanitizedQuery}%`);
      }
    }

    // Handle multi-keyword search
    if (options.keywords && options.keywords.length > 0) {
      const keywordConditions = options.keywords.map(() => 'value LIKE ?');
      const operator = options.keywordOperator === 'AND' ? ' AND ' : ' OR ';
      searchConditions.push(`(${keywordConditions.join(operator)})`);

      options.keywords.forEach(keyword => {
        const sanitizedKeyword = sanitizeSearchQuery(keyword);
        searchParams.push(`%${sanitizedKeyword}%`);
      });
    }

    // Handle LIKE pattern search
    if (options.likePattern) {
      searchConditions.push('value LIKE ?');
      searchParams.push(options.likePattern);
    }

    // If no search conditions, return empty results
    if (searchConditions.length === 0) {
      return [];
    }

    // Build the complete SQL query
    let sql = `
      SELECT key, value FROM cursorDiskKV
      WHERE key LIKE 'composerData:%'
      AND length(value) > ?
      AND (${searchConditions.join(' OR ')})
    `;

    const params: any[] = [
      this.config.minConversationSize || 5000,
      ...searchParams
    ];

    // Add format filter
    if (format === 'legacy') {
      sql += ` AND value NOT LIKE '%"_v":%'`;
    } else if (format === 'modern') {
      sql += ` AND value LIKE '%"_v":%'`;
    }

    sql += ` ORDER BY ROWID DESC LIMIT ?`;
    params.push(maxResults);

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as Array<{ key: string; value: string }>;

    const results: ConversationSearchResult[] = [];

    // Process each conversation
    for (const row of rows) {
      const composerId = extractComposerIdFromKey(row.key);
      if (!composerId) continue;

      try {
        const conversation = JSON.parse(row.value) as CursorConversation;
        const conversationFormat = isLegacyConversation(conversation) ? 'legacy' : 'modern';
        const matches: SearchMatch[] = [];

        // For message-level search, we need to check individual messages
        if (options.query || (options.keywords && options.keywords.length > 0)) {
          const searchTerms: string[] = [];
          if (options.query) searchTerms.push(options.query);
          if (options.keywords) searchTerms.push(...options.keywords);

          if (isLegacyConversation(conversation)) {
            // Search in legacy format messages
            conversation.conversation.forEach((message, index) => {
              const messageText = message.text.toLowerCase();

              for (const term of searchTerms) {
                const sanitizedTerm = sanitizeSearchQuery(term).toLowerCase();
                if (messageText.includes(sanitizedTerm)) {
                  matches.push({
                    messageIndex: index,
                    text: message.text,
                    context: this.extractContext(message.text, term, options?.contextLines || 3),
                    type: message.type
                  });
                  break; // Only add one match per message
                }
              }
            });
          } else if (isModernConversation(conversation) && options?.searchBubbles) {
            // Search in modern format bubble messages
            const headers = conversation.fullConversationHeadersOnly || [];

            for (let index = 0; index < headers.length; index++) {
              const header = headers[index];
              try {
                const bubbleMessage = await this.getBubbleMessage(composerId, header.bubbleId);
                if (bubbleMessage) {
                  const messageText = bubbleMessage.text.toLowerCase();

                  for (const term of searchTerms) {
                    const sanitizedTerm = sanitizeSearchQuery(term).toLowerCase();
                    if (messageText.includes(sanitizedTerm)) {
                      matches.push({
                        messageIndex: index,
                        bubbleId: header.bubbleId,
                        text: bubbleMessage.text,
                        context: this.extractContext(bubbleMessage.text, term, options?.contextLines || 3),
                        type: bubbleMessage.type
                      });
                      break; // Only add one match per message
                    }
                  }
                }
              } catch (error) {
                console.error(`Failed to resolve bubble ${header.bubbleId} during search:`, error);
              }
            }
          }
        } else {
          // For LIKE pattern only, we already filtered at SQL level, so include all
          matches.push({
            messageIndex: 0,
            text: 'Pattern match found in conversation data',
            context: 'LIKE pattern matched conversation content',
            type: 1
          });
        }

        if (matches.length > 0) {
          let relevantFiles: string[] = [];
          let attachedFolders: string[] = [];

          if (isLegacyConversation(conversation)) {
            for (const message of conversation.conversation) {
              if (message.relevantFiles) relevantFiles.push(...message.relevantFiles);
              if (message.attachedFoldersNew) attachedFolders.push(...message.attachedFoldersNew);
            }
          } else if (isModernConversation(conversation) && options?.searchBubbles) {
            // For modern format, collect files from bubble messages
            const headers = conversation.fullConversationHeadersOnly || [];
            for (const header of headers) {
              try {
                const bubbleMessage = await this.getBubbleMessage(composerId, header.bubbleId);
                if (bubbleMessage) {
                  if (bubbleMessage.relevantFiles) relevantFiles.push(...bubbleMessage.relevantFiles);
                  if (bubbleMessage.attachedFoldersNew) attachedFolders.push(...bubbleMessage.attachedFoldersNew);
                }
              } catch (error) {
                console.error(`Failed to resolve bubble ${header.bubbleId} for file extraction:`, error);
              }
            }
          }

          results.push({
            composerId,
            format: conversationFormat,
            matches,
            relevantFiles: Array.from(new Set(relevantFiles)),
            attachedFolders: Array.from(new Set(attachedFolders))
          });
        }
      } catch (error) {
        console.error(`Failed to parse conversation ${composerId} during enhanced search:`, error);
      }
    }

    // Apply date filtering if specified (post-query filtering due to unreliable timestamps)
    if (options.startDate || options.endDate) {
      const filteredResults = await this.filterResultsByDateRange(results, options.startDate, options.endDate);
      return filteredResults;
    }

    return results;
  }

  /**
   * Get conversation statistics
   */
  async getConversationStats(): Promise<ConversationStats> {
    this.ensureConnected();

    const sql = `
      SELECT key, length(value) as size, value FROM cursorDiskKV
      WHERE key LIKE 'composerData:%'
      AND length(value) > ?
    `;

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(this.config.minConversationSize || 5000) as Array<{
      key: string;
      size: number;
      value: string
    }>;

    let legacyCount = 0;
    let modernCount = 0;
    let totalSize = 0;
    let conversationsWithCode = 0;
    const fileCount = new Map<string, number>();
    const folderCount = new Map<string, number>();

    for (const row of rows) {
      totalSize += row.size;

      try {
        const conversation = JSON.parse(row.value) as CursorConversation;

        if (isLegacyConversation(conversation)) {
          legacyCount++;

          let hasCode = false;
          for (const message of conversation.conversation) {
            if (message.suggestedCodeBlocks && message.suggestedCodeBlocks.length > 0) {
              hasCode = true;
            }

            if (message.relevantFiles) {
              for (const file of message.relevantFiles) {
                fileCount.set(file, (fileCount.get(file) || 0) + 1);
              }
            }

            if (message.attachedFoldersNew) {
              for (const folder of message.attachedFoldersNew) {
                folderCount.set(folder, (folderCount.get(folder) || 0) + 1);
              }
            }
          }

          if (hasCode) conversationsWithCode++;
        } else if (isModernConversation(conversation)) {
          modernCount++;
          // Note: For modern format, we'd need to resolve bubbles to get accurate stats
          // This is a simplified version for performance
        }
      } catch (error) {
        console.error(`Failed to parse conversation during stats:`, error);
      }
    }

    const totalConversations = legacyCount + modernCount;
    const averageSize = totalConversations > 0 ? totalSize / totalConversations : 0;

    // Get top files and folders
    const mostCommonFiles = Array.from(fileCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }));

    const mostCommonFolders = Array.from(folderCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([folder, count]) => ({ folder, count }));

    return {
      totalConversations,
      legacyFormatCount: legacyCount,
      modernFormatCount: modernCount,
      averageConversationSize: Math.round(averageSize),
      totalConversationsWithCode: conversationsWithCode,
      mostCommonFiles,
      mostCommonFolders
    };
  }

  /**
   * Detect conversation format
   */
  async detectConversationFormat(composerId: string): Promise<'legacy' | 'modern' | null> {
    const conversation = await this.getConversationById(composerId);
    if (!conversation) return null;

    return isLegacyConversation(conversation) ? 'legacy' : 'modern';
  }

  /**
   * Get conversation summaries for analytics
   */
  async getConversationSummariesForAnalytics(
    conversationIds: string[],
    options?: { includeCodeBlocks?: boolean }
  ): Promise<ConversationSummary[]> {
    this.ensureConnected();

    const summaries: ConversationSummary[] = [];

    for (const composerId of conversationIds) {
      try {
        const summary = await this.getConversationSummary(composerId, {
          includeFirstMessage: true,
          includeCodeBlockCount: true,
          includeFileList: true,
          includeAttachedFolders: true,
          maxFirstMessageLength: 150
        });

        if (summary) {
          summaries.push(summary);
        }
      } catch (error) {
        console.error(`Failed to get summary for conversation ${composerId}:`, error);
      }
    }

    return summaries;
  }

  /**
   * Get conversations with code blocks for language analysis
   */
  async getConversationsWithCodeBlocks(
    conversationIds: string[]
  ): Promise<Array<{
    composerId: string;
    codeBlocks: Array<{ language: string; code: string; filename?: string }>;
  }>> {
    this.ensureConnected();

    const conversationsWithCode: Array<{
      composerId: string;
      codeBlocks: Array<{ language: string; code: string; filename?: string }>;
    }> = [];

    for (const composerId of conversationIds) {
      try {
        const conversation = await this.getConversationById(composerId);
        if (!conversation) continue;

        const codeBlocks: Array<{ language: string; code: string; filename?: string }> = [];

        if (isLegacyConversation(conversation)) {
          for (const message of conversation.conversation) {
            if (message.suggestedCodeBlocks) {
              for (const block of message.suggestedCodeBlocks) {
                codeBlocks.push({
                  language: block.language || 'text',
                  code: block.code,
                  filename: block.filename
                });
              }
            }
          }
        } else if (isModernConversation(conversation)) {
          // For modern format, resolve bubble messages to get code blocks
          const headers = conversation.fullConversationHeadersOnly || [];
          for (const header of headers) {
            try {
              const bubbleMessage = await this.getBubbleMessage(composerId, header.bubbleId);
              if (bubbleMessage && bubbleMessage.suggestedCodeBlocks) {
                for (const block of bubbleMessage.suggestedCodeBlocks) {
                  codeBlocks.push({
                    language: block.language || 'text',
                    code: block.code,
                    filename: block.filename
                  });
                }
              }
            } catch (error) {
              console.error(`Failed to resolve bubble ${header.bubbleId} for code blocks:`, error);
            }
          }
        }

        if (codeBlocks.length > 0) {
          conversationsWithCode.push({
            composerId,
            codeBlocks
          });
        }
      } catch (error) {
        console.error(`Failed to extract code blocks from conversation ${composerId}:`, error);
      }
    }

    return conversationsWithCode;
  }

  /**
   * Extract elements from conversations for generic extraction
   */
  async extractConversationElements(
    conversationIds: string[],
    elements: Array<'files' | 'folders' | 'languages' | 'codeblocks' | 'metadata' | 'structure'>,
    options?: {
      includeContext?: boolean;
      filters?: {
        minCodeLength?: number;
        fileExtensions?: string[];
        languages?: string[];
      };
    }
  ): Promise<Array<{
    composerId: string;
    format: 'legacy' | 'modern';
    elements: any;
  }>> {
    this.ensureConnected();

    const results: Array<{
      composerId: string;
      format: 'legacy' | 'modern';
      elements: any;
    }> = [];

    for (const composerId of conversationIds) {
      try {
        const conversation = await this.getConversationById(composerId);
        if (!conversation) continue;

        const format = isLegacyConversation(conversation) ? 'legacy' : 'modern';
        const extractedElements: any = {};

        // Extract files
        if (elements.includes('files')) {
          extractedElements.files = await this.extractFiles(conversation, options);
        }

        // Extract folders
        if (elements.includes('folders')) {
          extractedElements.folders = await this.extractFolders(conversation, options);
        }

        // Extract languages
        if (elements.includes('languages')) {
          extractedElements.languages = await this.extractLanguages(conversation, options);
        }

        // Extract code blocks
        if (elements.includes('codeblocks')) {
          extractedElements.codeblocks = await this.extractCodeBlocks(conversation, options);
        }

        // Extract metadata
        if (elements.includes('metadata')) {
          extractedElements.metadata = await this.extractMetadata(conversation);
        }

        // Extract structure
        if (elements.includes('structure')) {
          extractedElements.structure = await this.extractStructure(conversation);
        }

        results.push({
          composerId,
          format,
          elements: extractedElements
        });
      } catch (error) {
        console.error(`Failed to extract elements from conversation ${composerId}:`, error);
      }
    }

    return results;
  }

  /**
   * Extract files from conversation
   */
  private async extractFiles(
    conversation: CursorConversation,
    options?: { includeContext?: boolean }
  ): Promise<Array<{
    path: string;
    extension: string;
    context?: string;
    messageType: 'user' | 'assistant';
  }>> {
    const files: Array<{
      path: string;
      extension: string;
      context?: string;
      messageType: 'user' | 'assistant';
    }> = [];

    if (isLegacyConversation(conversation)) {
      for (const message of conversation.conversation) {
        if (message.relevantFiles) {
          for (const file of message.relevantFiles) {
            files.push({
              path: file,
              extension: this.getFileExtension(file),
              context: options?.includeContext ? message.text.substring(0, 200) : undefined,
              messageType: message.type === 1 ? 'user' : 'assistant'
            });
          }
        }
      }
    } else if (isModernConversation(conversation)) {
      const headers = conversation.fullConversationHeadersOnly || [];
      for (const header of headers) {
        try {
          const bubbleMessage = await this.getBubbleMessage(conversation.composerId, header.bubbleId);
          if (bubbleMessage && bubbleMessage.relevantFiles) {
            for (const file of bubbleMessage.relevantFiles) {
              files.push({
                path: file,
                extension: this.getFileExtension(file),
                context: options?.includeContext ? bubbleMessage.text.substring(0, 200) : undefined,
                messageType: bubbleMessage.type === 1 ? 'user' : 'assistant'
              });
            }
          }
        } catch (error) {
          console.error(`Failed to resolve bubble ${header.bubbleId} for files:`, error);
        }
      }
    }

    return files;
  }

  /**
   * Extract folders from conversation
   */
  private async extractFolders(
    conversation: CursorConversation,
    options?: { includeContext?: boolean }
  ): Promise<Array<{
    path: string;
    context?: string;
  }>> {
    const folders: Array<{
      path: string;
      context?: string;
    }> = [];

    if (isLegacyConversation(conversation)) {
      for (const message of conversation.conversation) {
        if (message.attachedFoldersNew) {
          for (const folder of message.attachedFoldersNew) {
            folders.push({
              path: folder,
              context: options?.includeContext ? message.text.substring(0, 200) : undefined
            });
          }
        }
      }
    } else if (isModernConversation(conversation)) {
      const headers = conversation.fullConversationHeadersOnly || [];
      for (const header of headers) {
        try {
          const bubbleMessage = await this.getBubbleMessage(conversation.composerId, header.bubbleId);
          if (bubbleMessage && bubbleMessage.attachedFoldersNew) {
            for (const folder of bubbleMessage.attachedFoldersNew) {
              folders.push({
                path: folder,
                context: options?.includeContext ? bubbleMessage.text.substring(0, 200) : undefined
              });
            }
          }
        } catch (error) {
          console.error(`Failed to resolve bubble ${header.bubbleId} for folders:`, error);
        }
      }
    }

    return folders;
  }

  /**
   * Extract languages from conversation
   */
  private async extractLanguages(
    conversation: CursorConversation,
    options?: { filters?: { languages?: string[] } }
  ): Promise<Array<{
    language: string;
    codeBlocks: number;
    totalLines: number;
    averageLength: number;
  }>> {
    const languageMap = new Map<string, { codeBlocks: number; totalLines: number; totalLength: number }>();

    if (isLegacyConversation(conversation)) {
      for (const message of conversation.conversation) {
        if (message.suggestedCodeBlocks) {
          for (const block of message.suggestedCodeBlocks) {
            const language = this.normalizeLanguage(block.language || 'text');
            if (options?.filters?.languages && !options.filters.languages.includes(language)) {
              continue;
            }

            if (!languageMap.has(language)) {
              languageMap.set(language, { codeBlocks: 0, totalLines: 0, totalLength: 0 });
            }

            const entry = languageMap.get(language)!;
            entry.codeBlocks++;
            entry.totalLines += block.code.split('\n').length;
            entry.totalLength += block.code.length;
          }
        }
      }
    } else if (isModernConversation(conversation)) {
      const headers = conversation.fullConversationHeadersOnly || [];
      for (const header of headers) {
        try {
          const bubbleMessage = await this.getBubbleMessage(conversation.composerId, header.bubbleId);
          if (bubbleMessage && bubbleMessage.suggestedCodeBlocks) {
            for (const block of bubbleMessage.suggestedCodeBlocks) {
              const language = this.normalizeLanguage(block.language || 'text');
              if (options?.filters?.languages && !options.filters.languages.includes(language)) {
                continue;
              }

              if (!languageMap.has(language)) {
                languageMap.set(language, { codeBlocks: 0, totalLines: 0, totalLength: 0 });
              }

              const entry = languageMap.get(language)!;
              entry.codeBlocks++;
              entry.totalLines += block.code.split('\n').length;
              entry.totalLength += block.code.length;
            }
          }
        } catch (error) {
          console.error(`Failed to resolve bubble ${header.bubbleId} for languages:`, error);
        }
      }
    }

    return Array.from(languageMap.entries()).map(([language, data]) => ({
      language,
      codeBlocks: data.codeBlocks,
      totalLines: data.totalLines,
      averageLength: data.codeBlocks > 0 ? data.totalLength / data.codeBlocks : 0
    }));
  }

  /**
   * Extract code blocks from conversation
   */
  private async extractCodeBlocks(
    conversation: CursorConversation,
    options?: {
      includeContext?: boolean;
      filters?: {
        minCodeLength?: number;
        languages?: string[];
      };
    }
  ): Promise<Array<{
    language: string;
    code: string;
    filename?: string;
    lineCount: number;
    messageType: 'user' | 'assistant';
    context?: string;
  }>> {
    const codeBlocks: Array<{
      language: string;
      code: string;
      filename?: string;
      lineCount: number;
      messageType: 'user' | 'assistant';
      context?: string;
    }> = [];

    if (isLegacyConversation(conversation)) {
      for (const message of conversation.conversation) {
        if (message.suggestedCodeBlocks) {
          for (const block of message.suggestedCodeBlocks) {
            const language = this.normalizeLanguage(block.language || 'text');

            // Apply filters
            if (options?.filters?.minCodeLength && block.code.length < options.filters.minCodeLength) {
              continue;
            }
            if (options?.filters?.languages && !options.filters.languages.includes(language)) {
              continue;
            }

            codeBlocks.push({
              language,
              code: block.code,
              filename: block.filename,
              lineCount: block.code.split('\n').length,
              messageType: message.type === 1 ? 'user' : 'assistant',
              context: options?.includeContext ? message.text.substring(0, 200) : undefined
            });
          }
        }
      }
    } else if (isModernConversation(conversation)) {
      const headers = conversation.fullConversationHeadersOnly || [];
      for (const header of headers) {
        try {
          const bubbleMessage = await this.getBubbleMessage(conversation.composerId, header.bubbleId);
          if (bubbleMessage && bubbleMessage.suggestedCodeBlocks) {
            for (const block of bubbleMessage.suggestedCodeBlocks) {
              const language = this.normalizeLanguage(block.language || 'text');

              // Apply filters
              if (options?.filters?.minCodeLength && block.code.length < options.filters.minCodeLength) {
                continue;
              }
              if (options?.filters?.languages && !options.filters.languages.includes(language)) {
                continue;
              }

              codeBlocks.push({
                language,
                code: block.code,
                filename: block.filename,
                lineCount: block.code.split('\n').length,
                messageType: bubbleMessage.type === 1 ? 'user' : 'assistant',
                context: options?.includeContext ? bubbleMessage.text.substring(0, 200) : undefined
              });
            }
          }
        } catch (error) {
          console.error(`Failed to resolve bubble ${header.bubbleId} for code blocks:`, error);
        }
      }
    }

    return codeBlocks;
  }

  /**
   * Extract metadata from conversation
   */
  private async extractMetadata(conversation: CursorConversation): Promise<{
    messageCount: number;
    size: number;
    format: 'legacy' | 'modern';
    userMessages: number;
    assistantMessages: number;
    hasCodeBlocks: boolean;
    hasFileReferences: boolean;
  }> {
    let messageCount = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let hasCodeBlocks = false;
    let hasFileReferences = false;

    if (isLegacyConversation(conversation)) {
      messageCount = conversation.conversation.length;

      for (const message of conversation.conversation) {
        if (message.type === 1) userMessages++;
        else assistantMessages++;

        if (message.suggestedCodeBlocks && message.suggestedCodeBlocks.length > 0) {
          hasCodeBlocks = true;
        }

        if (message.relevantFiles && message.relevantFiles.length > 0) {
          hasFileReferences = true;
        }
      }
    } else if (isModernConversation(conversation)) {
      const headers = conversation.fullConversationHeadersOnly || [];
      messageCount = headers.length;

      for (const header of headers) {
        if (header.type === 1) userMessages++;
        else assistantMessages++;

        try {
          const bubbleMessage = await this.getBubbleMessage(conversation.composerId, header.bubbleId);
          if (bubbleMessage) {
            if (bubbleMessage.suggestedCodeBlocks && bubbleMessage.suggestedCodeBlocks.length > 0) {
              hasCodeBlocks = true;
            }

            if (bubbleMessage.relevantFiles && bubbleMessage.relevantFiles.length > 0) {
              hasFileReferences = true;
            }
          }
        } catch (error) {
          console.error(`Failed to resolve bubble ${header.bubbleId} for metadata:`, error);
        }
      }
    }

    return {
      messageCount,
      size: JSON.stringify(conversation).length,
      format: isLegacyConversation(conversation) ? 'legacy' : 'modern',
      userMessages,
      assistantMessages,
      hasCodeBlocks,
      hasFileReferences
    };
  }

  /**
   * Extract structure from conversation
   */
  private async extractStructure(conversation: CursorConversation): Promise<{
    messageFlow: Array<{ type: 'user' | 'assistant'; length: number; hasCode: boolean }>;
    conversationPattern: string;
    averageMessageLength: number;
    longestMessage: number;
  }> {
    const messageFlow: Array<{ type: 'user' | 'assistant'; length: number; hasCode: boolean }> = [];
    let totalLength = 0;
    let longestMessage = 0;

    if (isLegacyConversation(conversation)) {
      for (const message of conversation.conversation) {
        const messageType = message.type === 1 ? 'user' : 'assistant';
                 const hasCode = !!(message.suggestedCodeBlocks && message.suggestedCodeBlocks.length > 0);
        const length = message.text.length;

        messageFlow.push({ type: messageType, length, hasCode });
        totalLength += length;
        longestMessage = Math.max(longestMessage, length);
      }
    } else if (isModernConversation(conversation)) {
      const headers = conversation.fullConversationHeadersOnly || [];

      for (const header of headers) {
        const messageType = header.type === 1 ? 'user' : 'assistant';
        let hasCode = false;
        let length = 0;

        try {
          const bubbleMessage = await this.getBubbleMessage(conversation.composerId, header.bubbleId);
          if (bubbleMessage) {
            hasCode = !!(bubbleMessage.suggestedCodeBlocks && bubbleMessage.suggestedCodeBlocks.length > 0);
            length = bubbleMessage.text.length;
          }
        } catch (error) {
          console.error(`Failed to resolve bubble ${header.bubbleId} for structure:`, error);
        }

        messageFlow.push({ type: messageType, length, hasCode });
        totalLength += length;
        longestMessage = Math.max(longestMessage, length);
      }
    }

    const conversationPattern = messageFlow.map(m => m.type === 'user' ? 'U' : 'A').join('-');
    const averageMessageLength = messageFlow.length > 0 ? totalLength / messageFlow.length : 0;

    return {
      messageFlow,
      conversationPattern,
      averageMessageLength,
      longestMessage
    };
  }

  /**
   * Get file extension from file path
   */
  private getFileExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));

    if (lastDot > lastSlash && lastDot !== -1) {
      return filePath.substring(lastDot + 1).toLowerCase();
    }

    return '';
  }

  /**
   * Normalize language names for consistency
   */
  private normalizeLanguage(language: string): string {
    const normalized = language.toLowerCase().trim();

    // Common language mappings
    const mappings: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',
      'yml': 'yaml',
      'md': 'markdown',
      'dockerfile': 'docker'
    };

    return mappings[normalized] || normalized;
  }

  /**
   * Extract context around a search match
   */
  private extractContext(text: string, query: string, contextLines: number): string {
    const lines = text.split('\n');
    const queryLower = query.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        return lines.slice(start, end).join('\n');
      }
    }

    return text.substring(0, 200) + '...';
  }

  /**
   * Filter results by date range
   */
  private async filterResultsByDateRange(results: ConversationSearchResult[], startDate?: string, endDate?: string): Promise<ConversationSearchResult[]> {
    const filteredResults: ConversationSearchResult[] = [];

    for (const result of results) {
      const conversation = await this.getConversationById(result.composerId);
      if (!conversation) continue;

      const conversationFormat = isLegacyConversation(conversation) ? 'legacy' : 'modern';
      const filteredMatches: SearchMatch[] = [];

      // Check each match for date filtering
      for (const match of result.matches) {
        let messageHasValidDate = false;

        if (conversationFormat === 'legacy') {
          const legacyConv = conversation as LegacyCursorConversation;
          if (match.messageIndex !== undefined && legacyConv.conversation[match.messageIndex]) {
            const message = legacyConv.conversation[match.messageIndex];
            if (message.timestamp) {
              const messageDate = new Date(message.timestamp).toISOString().split('T')[0];
              if ((!startDate || messageDate >= startDate) && (!endDate || messageDate <= endDate)) {
                messageHasValidDate = true;
              }
            } else {
              // If no timestamp, include the message (can't filter)
              messageHasValidDate = true;
            }
          }
        } else if (conversationFormat === 'modern' && match.bubbleId) {
          try {
            const bubbleMessage = await this.getBubbleMessage(result.composerId, match.bubbleId);
            if (bubbleMessage && bubbleMessage.timestamp) {
              const messageDate = new Date(bubbleMessage.timestamp).toISOString().split('T')[0];
              if ((!startDate || messageDate >= startDate) && (!endDate || messageDate <= endDate)) {
                messageHasValidDate = true;
              }
            } else {
              // If no timestamp, include the message (can't filter)
              messageHasValidDate = true;
            }
          } catch (error) {
            // If error resolving bubble, include the message
            messageHasValidDate = true;
          }
        } else {
          // No timestamp available, include the message
          messageHasValidDate = true;
        }

        if (messageHasValidDate) {
          filteredMatches.push(match);
        }
      }

      // Only include the result if it has valid matches after date filtering
      if (filteredMatches.length > 0) {
        filteredResults.push({
          ...result,
          matches: filteredMatches
        });
      }
    }

    return filteredResults;
  }
}