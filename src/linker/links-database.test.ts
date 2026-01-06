import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LinksDatabase } from './links-database.js';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('LinksDatabase', () => {
  let db: LinksDatabase;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = join(tmpdir(), `test-links-${Date.now()}.sqlite`);
    db = new LinksDatabase(testDbPath);
    await db.connect();
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('conversations', () => {
    it('should upsert and retrieve a conversation', () => {
      db.upsertConversation({
        conversationId: 'conv-1',
        workspaceRoot: '/Users/test/project',
        projectName: 'project',
        title: 'Test Conversation',
        summary: 'A test conversation',
        aiSummary: 'AI summary',
        relevantFiles: ['src/index.ts'],
        attachedFolders: ['/Users/test/project'],
        capturedFiles: ['src/utils.ts'],
        lastHookEvent: 'stop',
      });

      const retrieved = db.getConversation('conv-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.conversationId).toBe('conv-1');
      expect(retrieved?.title).toBe('Test Conversation');
      expect(retrieved?.relevantFiles).toEqual(['src/index.ts']);
      expect(retrieved?.capturedFiles).toEqual(['src/utils.ts']);
    });

    it('should merge capturedFiles on upsert', () => {
      db.upsertConversation({
        conversationId: 'conv-2',
        workspaceRoot: '/Users/test/project',
        projectName: 'project',
        title: null,
        summary: null,
        aiSummary: null,
        relevantFiles: [],
        attachedFolders: [],
        capturedFiles: ['file1.ts'],
        lastHookEvent: 'afterFileEdit',
      });

      db.upsertConversation({
        conversationId: 'conv-2',
        workspaceRoot: '/Users/test/project',
        projectName: 'project',
        title: 'Updated Title',
        summary: null,
        aiSummary: null,
        relevantFiles: [],
        attachedFolders: [],
        capturedFiles: ['file2.ts'],
        lastHookEvent: 'afterFileEdit',
      });

      const retrieved = db.getConversation('conv-2');
      expect(retrieved?.capturedFiles).toContain('file1.ts');
      expect(retrieved?.capturedFiles).toContain('file2.ts');
      expect(retrieved?.title).toBe('Updated Title');
    });

    it('should find conversations by workspace', () => {
      db.upsertConversation({
        conversationId: 'conv-ws-1',
        workspaceRoot: '/Users/test/project-a',
        projectName: 'project-a',
        title: null,
        summary: null,
        aiSummary: null,
        relevantFiles: [],
        attachedFolders: [],
        capturedFiles: [],
        lastHookEvent: null,
      });

      db.upsertConversation({
        conversationId: 'conv-ws-2',
        workspaceRoot: '/Users/test/project-b',
        projectName: 'project-b',
        title: null,
        summary: null,
        aiSummary: null,
        relevantFiles: [],
        attachedFolders: [],
        capturedFiles: [],
        lastHookEvent: null,
      });

      const results = db.findConversations({ workspaceRoot: '/Users/test/project-a' });
      expect(results).toHaveLength(1);
      expect(results[0].conversationId).toBe('conv-ws-1');
    });
  });

  describe('commits', () => {
    it('should upsert and retrieve a commit', () => {
      db.upsertCommit({
        commitHash: 'abc123def456',
        repoPath: '/Users/test/project',
        branch: 'main',
        author: 'Test User <test@example.com>',
        message: 'Fix bug in utils',
        committedAt: '2024-01-15T10:30:00Z',
        changedFiles: ['src/utils.ts', 'src/index.ts'],
      });

      const retrieved = db.getCommit('abc123def456');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.branch).toBe('main');
      expect(retrieved?.changedFiles).toEqual(['src/utils.ts', 'src/index.ts']);
    });

    it('should find commits by date range', () => {
      db.upsertCommit({
        commitHash: 'old-commit',
        repoPath: '/Users/test/project',
        branch: 'main',
        author: 'Test',
        message: 'Old commit',
        committedAt: '2024-01-01T10:00:00Z',
        changedFiles: [],
      });

      db.upsertCommit({
        commitHash: 'new-commit',
        repoPath: '/Users/test/project',
        branch: 'main',
        author: 'Test',
        message: 'New commit',
        committedAt: '2024-01-20T10:00:00Z',
        changedFiles: [],
      });

      const results = db.findCommits({
        since: '2024-01-15T00:00:00Z',
      });
      expect(results).toHaveLength(1);
      expect(results[0].commitHash).toBe('new-commit');
    });
  });

  describe('links', () => {
    it('should create and retrieve links', () => {
      db.upsertConversation({
        conversationId: 'link-conv',
        workspaceRoot: '/project',
        projectName: 'project',
        title: 'Test',
        summary: null,
        aiSummary: null,
        relevantFiles: ['src/file.ts'],
        attachedFolders: [],
        capturedFiles: [],
        lastHookEvent: null,
      });

      db.upsertCommit({
        commitHash: 'link-commit',
        repoPath: '/project',
        branch: 'main',
        author: 'Test',
        message: 'Commit message',
        committedAt: '2024-01-15T10:00:00Z',
        changedFiles: ['src/file.ts'],
      });

      db.upsertLink({
        conversationId: 'link-conv',
        commitHash: 'link-commit',
        matchedFiles: ['src/file.ts'],
        confidence: 0.85,
        status: 'auto',
      });

      const convLinks = db.getLinksForConversation('link-conv');
      expect(convLinks).toHaveLength(1);
      expect(convLinks[0].link.confidence).toBe(0.85);
      expect(convLinks[0].commit.commitHash).toBe('link-commit');

      const commitLinks = db.getLinksForCommit('link-commit');
      expect(commitLinks).toHaveLength(1);
      expect(commitLinks[0].conversation.conversationId).toBe('link-conv');
    });
  });

  describe('auto-linking', () => {
    it('should find candidates based on file overlap and recency', () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      db.upsertConversation({
        conversationId: 'recent-conv',
        workspaceRoot: '/project',
        projectName: 'project',
        title: null,
        summary: null,
        aiSummary: null,
        relevantFiles: ['src/file.ts', 'src/utils.ts'],
        attachedFolders: [],
        capturedFiles: ['src/file.ts'],
        lastHookEvent: 'stop',
        updatedAt: twoDaysAgo.toISOString(),
      });

      db.upsertCommit({
        commitHash: 'auto-link-commit',
        repoPath: '/project',
        branch: 'main',
        author: 'Test',
        message: 'Update file',
        committedAt: now.toISOString(),
        changedFiles: ['src/file.ts'],
      });

      const candidates = db.findAutoLinkCandidates('auto-link-commit');
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].conversationId).toBe('recent-conv');
      expect(candidates[0].matchedFiles).toContain('src/file.ts');
      expect(candidates[0].score).toBeGreaterThanOrEqual(0.2);
    });

    it('should not include conversations outside the time window', () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      db.upsertConversation({
        conversationId: 'old-conv',
        workspaceRoot: '/project',
        projectName: 'project',
        title: null,
        summary: null,
        aiSummary: null,
        relevantFiles: ['src/file.ts'],
        attachedFolders: [],
        capturedFiles: [],
        lastHookEvent: 'stop',
        updatedAt: thirtyDaysAgo.toISOString(),
      });

      db.upsertCommit({
        commitHash: 'recent-only-commit',
        repoPath: '/project',
        branch: 'main',
        author: 'Test',
        message: 'Update file',
        committedAt: now.toISOString(),
        changedFiles: ['src/file.ts'],
      });

      const candidates = db.findAutoLinkCandidates('recent-only-commit', { windowDays: 14 });
      expect(candidates).toHaveLength(0);
    });
  });

  describe('file context', () => {
    it('should find conversations and commits related to a file', () => {
      db.upsertConversation({
        conversationId: 'file-conv',
        workspaceRoot: '/project',
        projectName: 'project',
        title: 'File context test',
        summary: null,
        aiSummary: null,
        relevantFiles: ['src/target.ts'],
        attachedFolders: [],
        capturedFiles: [],
        lastHookEvent: null,
      });

      db.upsertCommit({
        commitHash: 'file-commit',
        repoPath: '/project',
        branch: 'main',
        author: 'Test',
        message: 'Update target',
        committedAt: '2024-01-15T10:00:00Z',
        changedFiles: ['src/target.ts'],
      });

      const context = db.getFileContext('src/target.ts');
      expect(context.conversations).toHaveLength(1);
      expect(context.conversations[0].relevance).toBe('direct');
      expect(context.commits).toHaveLength(1);
      expect(context.commits[0].relevance).toBe('direct');
    });
  });
});
