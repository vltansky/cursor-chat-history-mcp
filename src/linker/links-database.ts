/**
 * Links database manager for the Conversation ↔ Git Linker feature
 * Handles SQLite operations for conversations, commits, and links tables
 */

import Database from 'better-sqlite3';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type {
  ConversationRecord,
  CommitRecord,
  LinkRecord,
  AutoLinkScore,
} from './types.js';

/**
 * Get the platform-specific links database path
 */
export function getLinksDbPath(): string {
  const envPath = process.env.CURSOR_LINKS_DB_PATH;
  if (envPath) return envPath;

  const os = platform();
  switch (os) {
    case 'darwin':
      return join(homedir(), 'Library/Application Support/CursorChatHistory/links.sqlite');
    case 'win32':
      return join(homedir(), 'AppData/Roaming/CursorChatHistory/links.sqlite');
    default:
      return join(homedir(), '.local/share/CursorChatHistory/links.sqlite');
  }
}

/**
 * Ensure the database directory exists
 */
function ensureDbDirectory(dbPath: string): void {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Links database manager class
 */
export class LinksDatabase {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? getLinksDbPath();
  }

  /**
   * Initialize the database connection and create tables if needed
   */
  async connect(): Promise<void> {
    if (this.db) return;

    ensureDbDirectory(this.dbPath);
    this.db = new Database(this.dbPath);
    this.createTables();
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Create the database tables if they don't exist
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not connected');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        conversationId TEXT PRIMARY KEY,
        agent TEXT NOT NULL DEFAULT 'cursor',
        workspaceRoot TEXT NOT NULL,
        projectName TEXT NOT NULL,
        title TEXT,
        summary TEXT,
        aiSummary TEXT,
        relevantFiles TEXT NOT NULL DEFAULT '[]',
        attachedFolders TEXT NOT NULL DEFAULT '[]',
        capturedFiles TEXT NOT NULL DEFAULT '[]',
        searchableText TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastHookEvent TEXT
      );

      CREATE TABLE IF NOT EXISTS commits (
        commitHash TEXT PRIMARY KEY,
        repoPath TEXT NOT NULL,
        branch TEXT NOT NULL,
        author TEXT NOT NULL,
        message TEXT NOT NULL,
        committedAt TEXT NOT NULL,
        changedFiles TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversationId TEXT NOT NULL,
        commitHash TEXT NOT NULL,
        matchedFiles TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('auto', 'manual')),
        createdAt TEXT NOT NULL,
        FOREIGN KEY (conversationId) REFERENCES conversations(conversationId),
        FOREIGN KEY (commitHash) REFERENCES commits(commitHash),
        UNIQUE(conversationId, commitHash)
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspaceRoot);
      CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(projectName);
      CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent);
      CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repoPath);
      CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(committedAt);
      CREATE INDEX IF NOT EXISTS idx_links_conversation ON links(conversationId);
      CREATE INDEX IF NOT EXISTS idx_links_commit ON links(commitHash);
    `);
  }

  private ensureConnected(): void {
    if (!this.db) throw new Error('Database not connected. Call connect() first.');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Conversation operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Upsert a conversation record
   */
  upsertConversation(conv: Omit<ConversationRecord, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }): void {
    this.ensureConnected();

    const now = new Date().toISOString();

    // Merge capturedFiles in JS since SQLite doesn't support subqueries in ON CONFLICT
    const existingConv = this.getConversation(conv.conversationId);
    let mergedCapturedFiles = conv.capturedFiles;
    if (existingConv) {
      const existingSet = new Set(existingConv.capturedFiles);
      conv.capturedFiles.forEach(f => existingSet.add(f));
      mergedCapturedFiles = Array.from(existingSet);
    }

    const simpleStmt = this.db!.prepare(`
      INSERT INTO conversations (
        conversationId, agent, workspaceRoot, projectName, title, summary, aiSummary,
        relevantFiles, attachedFolders, capturedFiles, searchableText, createdAt, updatedAt, lastHookEvent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversationId) DO UPDATE SET
        agent = excluded.agent,
        workspaceRoot = excluded.workspaceRoot,
        projectName = excluded.projectName,
        title = COALESCE(excluded.title, conversations.title),
        summary = COALESCE(excluded.summary, conversations.summary),
        aiSummary = COALESCE(excluded.aiSummary, conversations.aiSummary),
        relevantFiles = excluded.relevantFiles,
        attachedFolders = excluded.attachedFolders,
        capturedFiles = excluded.capturedFiles,
        searchableText = COALESCE(excluded.searchableText, conversations.searchableText),
        updatedAt = excluded.updatedAt,
        lastHookEvent = excluded.lastHookEvent
    `);

    simpleStmt.run(
      conv.conversationId,
      conv.agent ?? 'cursor',
      conv.workspaceRoot,
      conv.projectName,
      conv.title,
      conv.summary,
      conv.aiSummary,
      JSON.stringify(conv.relevantFiles),
      JSON.stringify(conv.attachedFolders),
      JSON.stringify(mergedCapturedFiles),
      conv.searchableText ?? null,
      conv.createdAt ?? now,
      conv.updatedAt ?? now,
      conv.lastHookEvent
    );
  }

  /**
   * Get a conversation by ID
   */
  getConversation(conversationId: string): ConversationRecord | null {
    this.ensureConnected();

    const stmt = this.db!.prepare('SELECT * FROM conversations WHERE conversationId = ?');
    const row = stmt.get(conversationId) as any;

    if (!row) return null;

    return {
      ...row,
      relevantFiles: JSON.parse(row.relevantFiles),
      attachedFolders: JSON.parse(row.attachedFolders),
      capturedFiles: JSON.parse(row.capturedFiles),
      searchableText: row.searchableText,
    };
  }

  /**
   * Find conversations by workspace or project
   */
  findConversations(options: {
    workspaceRoot?: string;
    projectName?: string;
    file?: string;
    agent?: string;
    limit?: number;
  }): ConversationRecord[] {
    this.ensureConnected();

    let sql = 'SELECT * FROM conversations WHERE 1=1';
    const params: any[] = [];

    if (options.workspaceRoot) {
      sql += ' AND workspaceRoot = ?';
      params.push(options.workspaceRoot);
    }

    if (options.projectName) {
      sql += ' AND projectName = ?';
      params.push(options.projectName);
    }

    if (options.file) {
      sql += ' AND (relevantFiles LIKE ? OR capturedFiles LIKE ?)';
      const pattern = `%${options.file}%`;
      params.push(pattern, pattern);
    }

    if (options.agent) {
      sql += ' AND agent = ?';
      params.push(options.agent);
    }

    sql += ' ORDER BY updatedAt DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      ...row,
      relevantFiles: JSON.parse(row.relevantFiles),
      attachedFolders: JSON.parse(row.attachedFolders),
      capturedFiles: JSON.parse(row.capturedFiles),
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Commit operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Insert or update a commit record
   */
  upsertCommit(commit: Omit<CommitRecord, 'createdAt'> & { createdAt?: string }): void {
    this.ensureConnected();

    const now = new Date().toISOString();
    const stmt = this.db!.prepare(`
      INSERT INTO commits (
        commitHash, repoPath, branch, author, message, committedAt, changedFiles, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(commitHash) DO UPDATE SET
        repoPath = excluded.repoPath,
        branch = excluded.branch,
        author = excluded.author,
        message = excluded.message,
        committedAt = excluded.committedAt,
        changedFiles = excluded.changedFiles
    `);

    stmt.run(
      commit.commitHash,
      commit.repoPath,
      commit.branch,
      commit.author,
      commit.message,
      commit.committedAt,
      JSON.stringify(commit.changedFiles),
      commit.createdAt ?? now
    );
  }

  /**
   * Get a commit by hash
   */
  getCommit(commitHash: string): CommitRecord | null {
    this.ensureConnected();

    const stmt = this.db!.prepare('SELECT * FROM commits WHERE commitHash = ?');
    const row = stmt.get(commitHash) as any;

    if (!row) return null;

    return {
      ...row,
      changedFiles: JSON.parse(row.changedFiles),
    };
  }

  /**
   * Find commits by repo or date range
   */
  findCommits(options: {
    repoPath?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): CommitRecord[] {
    this.ensureConnected();

    let sql = 'SELECT * FROM commits WHERE 1=1';
    const params: any[] = [];

    if (options.repoPath) {
      sql += ' AND repoPath = ?';
      params.push(options.repoPath);
    }

    if (options.since) {
      sql += ' AND committedAt >= ?';
      params.push(options.since);
    }

    if (options.until) {
      sql += ' AND committedAt <= ?';
      params.push(options.until);
    }

    sql += ' ORDER BY committedAt DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      ...row,
      changedFiles: JSON.parse(row.changedFiles),
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Link operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create or update a link between conversation and commit
   */
  upsertLink(link: Omit<LinkRecord, 'id' | 'createdAt'>): void {
    this.ensureConnected();

    const now = new Date().toISOString();
    const stmt = this.db!.prepare(`
      INSERT INTO links (conversationId, commitHash, matchedFiles, confidence, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversationId, commitHash) DO UPDATE SET
        matchedFiles = excluded.matchedFiles,
        confidence = excluded.confidence,
        status = excluded.status
    `);

    stmt.run(
      link.conversationId,
      link.commitHash,
      JSON.stringify(link.matchedFiles),
      link.confidence,
      link.status,
      now
    );
  }

  /**
   * Get links for a conversation
   */
  getLinksForConversation(conversationId: string): Array<{ link: LinkRecord; commit: CommitRecord }> {
    this.ensureConnected();

    const stmt = this.db!.prepare(`
      SELECT l.*, c.*,
             l.id as linkId, l.createdAt as linkCreatedAt,
             c.createdAt as commitCreatedAt
      FROM links l
      JOIN commits c ON l.commitHash = c.commitHash
      WHERE l.conversationId = ?
      ORDER BY c.committedAt DESC
    `);

    const rows = stmt.all(conversationId) as any[];

    return rows.map(row => ({
      link: {
        id: row.linkId,
        conversationId: row.conversationId,
        commitHash: row.commitHash,
        matchedFiles: JSON.parse(row.matchedFiles),
        confidence: row.confidence,
        status: row.status,
        createdAt: row.linkCreatedAt,
      },
      commit: {
        commitHash: row.commitHash,
        repoPath: row.repoPath,
        branch: row.branch,
        author: row.author,
        message: row.message,
        committedAt: row.committedAt,
        changedFiles: JSON.parse(row.changedFiles),
        createdAt: row.commitCreatedAt,
      },
    }));
  }

  /**
   * Get links for a commit
   */
  getLinksForCommit(commitHash: string): Array<{ link: LinkRecord; conversation: ConversationRecord }> {
    this.ensureConnected();

    const stmt = this.db!.prepare(`
      SELECT l.*, conv.*,
             l.id as linkId, l.createdAt as linkCreatedAt,
             conv.createdAt as convCreatedAt, conv.updatedAt as convUpdatedAt
      FROM links l
      JOIN conversations conv ON l.conversationId = conv.conversationId
      WHERE l.commitHash = ?
      ORDER BY l.confidence DESC
    `);

    const rows = stmt.all(commitHash) as any[];

    return rows.map(row => ({
      link: {
        id: row.linkId,
        conversationId: row.conversationId,
        commitHash: row.commitHash,
        matchedFiles: JSON.parse(row.matchedFiles),
        confidence: row.confidence,
        status: row.status,
        createdAt: row.linkCreatedAt,
      },
      conversation: {
        conversationId: row.conversationId,
        agent: row.agent ?? 'cursor',
        workspaceRoot: row.workspaceRoot,
        projectName: row.projectName,
        title: row.title,
        summary: row.summary,
        aiSummary: row.aiSummary,
        relevantFiles: JSON.parse(row.relevantFiles),
        attachedFolders: JSON.parse(row.attachedFolders),
        capturedFiles: JSON.parse(row.capturedFiles),
        searchableText: row.searchableText,
        createdAt: row.convCreatedAt,
        updatedAt: row.convUpdatedAt,
        lastHookEvent: row.lastHookEvent,
      },
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Auto-linking logic
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find candidate conversations for auto-linking with a commit
   * Uses file overlap (0.7 weight) + recency (0.3 weight)
   * Window: 14 days, minimum score: 0.2
   */
  findAutoLinkCandidates(commitHash: string, options?: {
    windowDays?: number;
    minScore?: number;
  }): AutoLinkScore[] {
    this.ensureConnected();

    const windowDays = options?.windowDays ?? 14;
    const minScore = options?.minScore ?? 0.2;

    const commit = this.getCommit(commitHash);
    if (!commit || commit.changedFiles.length === 0) return [];

    const commitDate = new Date(commit.committedAt);
    const windowStart = new Date(commitDate.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    // Find conversations updated within the window
    const stmt = this.db!.prepare(`
      SELECT * FROM conversations
      WHERE updatedAt >= ? AND updatedAt <= ?
      ORDER BY updatedAt DESC
    `);

    const rows = stmt.all(windowStart, commit.committedAt) as any[];
    const candidates: AutoLinkScore[] = [];

    const commitFiles = new Set(commit.changedFiles.map(f => this.normalizePath(f)));

    for (const row of rows) {
      const convFiles = new Set([
        ...JSON.parse(row.relevantFiles).map((f: string) => this.normalizePath(f)),
        ...JSON.parse(row.capturedFiles).map((f: string) => this.normalizePath(f)),
      ]);

      // Calculate file overlap
      const matchedFiles: string[] = [];
      for (const commitFile of commitFiles) {
        if (convFiles.has(commitFile)) {
          matchedFiles.push(commitFile);
        }
      }

      const fileOverlap = commitFiles.size > 0
        ? matchedFiles.length / commitFiles.size
        : 0;

      // Calculate recency (1.0 = same day, 0.0 = edge of window)
      const convDate = new Date(row.updatedAt);
      const daysDiff = (commitDate.getTime() - convDate.getTime()) / (24 * 60 * 60 * 1000);
      const recency = Math.max(0, 1 - daysDiff / windowDays);

      // Combined score: 0.7 * file overlap + 0.3 * recency
      const score = 0.7 * fileOverlap + 0.3 * recency;

      if (score >= minScore) {
        candidates.push({
          conversationId: row.conversationId,
          score,
          fileOverlap,
          recency,
          matchedFiles,
        });
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return candidates;
  }

  /**
   * Normalize file path for comparison
   */
  private normalizePath(filePath: string): string {
    // Remove leading slashes and normalize separators
    return filePath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // File context queries
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find conversations and commits related to a file
   * Supports optional keyword filtering on searchableText
   */
  getFileContext(filePath: string, options?: {
    limit?: number;
    keywords?: string[];
  }): {
    conversations: Array<{
      conversation: ConversationRecord;
      relevance: 'direct' | 'indirect';
      keywordMatches?: Array<{ keyword: string; count: number; excerpts: string[] }>;
    }>;
    commits: Array<{ commit: CommitRecord; relevance: 'direct' | 'indirect' }>;
  } {
    this.ensureConnected();

    const limit = options?.limit ?? 10;
    const keywords = options?.keywords ?? [];
    const normalizedPath = this.normalizePath(filePath);

    // Build SQL query - add keyword filtering if provided
    let sql = `
      SELECT * FROM conversations
      WHERE (relevantFiles LIKE ? OR capturedFiles LIKE ?)
    `;
    const params: any[] = [`%${normalizedPath}%`, `%${normalizedPath}%`];

    if (keywords.length > 0) {
      // Add keyword filter (any keyword matches)
      const keywordConditions = keywords.map(() => 'searchableText LIKE ?').join(' OR ');
      sql += ` AND (${keywordConditions})`;
      keywords.forEach(kw => params.push(`%${kw}%`));
    }

    sql += ' ORDER BY updatedAt DESC LIMIT ?';
    params.push(limit * 2);

    const convStmt = this.db!.prepare(sql);
    const convRows = convStmt.all(...params) as any[];

    const conversations = convRows.map(row => {
      const relevantFiles = JSON.parse(row.relevantFiles) as string[];
      const capturedFiles = JSON.parse(row.capturedFiles) as string[];
      const searchableText = row.searchableText as string | null;

      const isDirect = relevantFiles.some(f => this.normalizePath(f) === normalizedPath) ||
                      capturedFiles.some(f => this.normalizePath(f) === normalizedPath);

      // Calculate keyword matches if keywords provided and searchableText exists
      let keywordMatches: Array<{ keyword: string; count: number; excerpts: string[] }> | undefined;
      if (keywords.length > 0 && searchableText) {
        keywordMatches = keywords.map(kw => {
          const regex = new RegExp(kw, 'gi');
          const matches = searchableText.match(regex) || [];
          const excerpts = this.extractExcerpts(searchableText, kw, 3);
          return {
            keyword: kw,
            count: matches.length,
            excerpts,
          };
        }).filter(m => m.count > 0);
      }

      return {
        conversation: {
          ...row,
          relevantFiles,
          attachedFolders: JSON.parse(row.attachedFolders),
          capturedFiles,
          searchableText,
        } as ConversationRecord,
        relevance: (isDirect ? 'direct' : 'indirect') as 'direct' | 'indirect',
        keywordMatches,
      };
    }).slice(0, limit);

    // Find commits with this file
    const commitStmt = this.db!.prepare(`
      SELECT * FROM commits
      WHERE changedFiles LIKE ?
      ORDER BY committedAt DESC
      LIMIT ?
    `);

    const commitRows = commitStmt.all(`%${normalizedPath}%`, limit * 2) as any[];

    const commits: Array<{ commit: CommitRecord; relevance: 'direct' | 'indirect' }> = commitRows.map(row => {
      const changedFiles = JSON.parse(row.changedFiles) as string[];
      const isDirect = changedFiles.some(f => this.normalizePath(f) === normalizedPath);

      return {
        commit: {
          ...row,
          changedFiles,
        } as CommitRecord,
        relevance: (isDirect ? 'direct' : 'indirect') as 'direct' | 'indirect',
      };
    }).slice(0, limit);

    return { conversations, commits };
  }

  /**
   * Extract excerpts around keyword matches
   */
  private extractExcerpts(text: string, keyword: string, maxExcerpts: number = 3): string[] {
    const excerpts: string[] = [];
    const regex = new RegExp(keyword, 'gi');
    let match;
    const contextChars = 50;

    while ((match = regex.exec(text)) !== null && excerpts.length < maxExcerpts) {
      const start = Math.max(0, match.index - contextChars);
      const end = Math.min(text.length, match.index + keyword.length + contextChars);
      let excerpt = text.slice(start, end);

      // Add ellipsis if truncated
      if (start > 0) excerpt = '...' + excerpt;
      if (end < text.length) excerpt = excerpt + '...';

      excerpts.push(excerpt);
    }

    return excerpts;
  }
}
