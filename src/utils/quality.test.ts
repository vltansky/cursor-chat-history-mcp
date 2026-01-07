import { describe, it, expect } from 'vitest';
import { calculateQualityScore, meetsQualityThreshold } from './quality.js';

describe('calculateQualityScore', () => {
  it('should score conversation with code blocks', () => {
    const result = calculateQualityScore({
      messageCount: 4,
      hasCodeBlocks: true,
      codeBlockCount: 3,
    });

    expect(result.score).toBeGreaterThan(0);
    expect(result.factors.hasCodeBlocks).toBe(true);
    expect(result.breakdown.codeBlocks).toBeGreaterThan(0);
  });

  it('should score conversation with solution indicators', () => {
    const result = calculateQualityScore({
      messageCount: 4,
      hasCodeBlocks: false,
      messages: [
        { type: 1, text: 'How do I fix this?' },
        { type: 2, text: 'Try this approach...' },
        { type: 1, text: 'That fixed it, thanks!' },
      ],
    });

    expect(result.factors.hasSolutionIndicators).toBe(true);
    expect(result.breakdown.solutionIndicators).toBe(25);
  });

  it('should apply negative score for ongoing problems', () => {
    const result = calculateQualityScore({
      messageCount: 4,
      hasCodeBlocks: true,
      codeBlockCount: 2,
      messages: [
        { type: 1, text: 'It still not working after your fix' },
        { type: 2, text: 'Let me try something else...' },
      ],
    });

    expect(result.factors.hasOngoingProblems).toBe(true);
    expect(result.breakdown.ongoingProblems).toBe(-10);
  });

  it('should not go below 0', () => {
    const result = calculateQualityScore({
      messageCount: 1,
      hasCodeBlocks: false,
      searchableText: "still not working and doesn't work at all",
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('should score conversation with file references', () => {
    const result = calculateQualityScore({
      messageCount: 2,
      hasCodeBlocks: false,
      relevantFiles: ['src/app.ts', 'src/utils.ts', 'package.json'],
    });

    expect(result.factors.hasFileReferences).toBe(true);
    expect(result.factors.fileReferenceCount).toBe(3);
    expect(result.breakdown.fileReferences).toBeGreaterThan(0);
  });

  it('should score deep conversations higher', () => {
    const shallow = calculateQualityScore({
      messageCount: 2,
      hasCodeBlocks: false,
    });

    const deep = calculateQualityScore({
      messageCount: 15,
      hasCodeBlocks: false,
    });

    expect(deep.factors.conversationDepth).toBe('deep');
    expect(shallow.factors.conversationDepth).toBe('shallow');
    expect(deep.breakdown.conversationDepth).toBeGreaterThan(shallow.breakdown.conversationDepth);
  });

  it('should score git-linked conversations higher', () => {
    const withLink = calculateQualityScore({
      messageCount: 4,
      hasCodeBlocks: true,
      linkedCommits: ['abc123'],
    });

    const withoutLink = calculateQualityScore({
      messageCount: 4,
      hasCodeBlocks: true,
    });

    expect(withLink.factors.hasGitLink).toBe(true);
    expect(withLink.score).toBeGreaterThan(withoutLink.score);
    expect(withLink.breakdown.gitLink).toBe(10);
  });

  it('should cap score at 100', () => {
    const result = calculateQualityScore({
      messageCount: 20,
      hasCodeBlocks: true,
      codeBlockCount: 10,
      relevantFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      linkedCommits: ['abc123'],
      messages: [
        { type: 1, text: 'question' },
        { type: 2, text: 'That fixed it perfectly!' },
      ],
    });

    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('meetsQualityThreshold', () => {
  it('should always pass when threshold is 0', () => {
    const result = meetsQualityThreshold({
      messageCount: 1,
      hasCodeBlocks: false,
    }, 0);

    expect(result).toBe(true);
  });

  it('should pass high-quality conversations', () => {
    const result = meetsQualityThreshold({
      messageCount: 10,
      hasCodeBlocks: true,
      codeBlockCount: 5,
      relevantFiles: ['src/app.ts'],
    }, 30);

    expect(result).toBe(true);
  });

  it('should fail low-quality conversations with high threshold', () => {
    const result = meetsQualityThreshold({
      messageCount: 1,
      hasCodeBlocks: false,
    }, 80);

    expect(result).toBe(false);
  });
});
