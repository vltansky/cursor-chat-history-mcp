import { describe, it, expect } from 'vitest';
import { detectTopics, getPrimaryTopic, clusterByTopic, getTopicDistribution } from './topic-clustering.js';

describe('detectTopics', () => {
  it('should detect authentication topics', () => {
    const text = 'How do I implement JWT authentication with login and logout?';
    const topics = detectTopics(text);

    expect(topics).toHaveLength(1);
    expect(topics[0].topic).toBe('authentication');
    expect(topics[0].matchedTerms).toContain('jwt');
    expect(topics[0].matchedTerms).toContain('login');
  });

  it('should detect multiple topics', () => {
    const text = 'I need to fix a bug in my React component that fetches data from the API';
    const topics = detectTopics(text);

    const topicNames = topics.map(t => t.topic);
    expect(topicNames).toContain('debugging');
    expect(topicNames).toContain('frontend');
    expect(topicNames).toContain('api');
  });

  it('should rank topics by match count', () => {
    const text = 'React component with multiple React hooks and React context for state management';
    const topics = detectTopics(text);

    expect(topics[0].topic).toBe('frontend');
    expect(topics[0].score).toBeGreaterThan(1);
  });

  it('should return empty array for no matches', () => {
    const text = 'Hello world this is a simple test';
    const topics = detectTopics(text);

    expect(topics).toHaveLength(1); // 'test' matches testing
  });

  it('should detect database topics', () => {
    const text = 'How do I write a SQL query for PostgreSQL with Prisma ORM?';
    const topics = detectTopics(text);

    expect(topics[0].topic).toBe('database');
    expect(topics[0].matchedTerms).toContain('sql');
    expect(topics[0].matchedTerms).toContain('postgresql');
    expect(topics[0].matchedTerms).toContain('prisma');
    expect(topics[0].matchedTerms).toContain('orm');
  });
});

describe('getPrimaryTopic', () => {
  it('should return primary topic', () => {
    const topic = getPrimaryTopic('Help me debug this React component');
    expect(['debugging', 'frontend']).toContain(topic);
  });

  it('should return general for unrecognized text', () => {
    const topic = getPrimaryTopic('something completely random xyz');
    expect(topic).toBe('general');
  });
});

describe('clusterByTopic', () => {
  it('should cluster conversations by topic', () => {
    const conversations = [
      { conversationId: '1', searchableText: 'Implement login and logout authentication' },
      { conversationId: '2', searchableText: 'Add JWT token for authentication' },
      { conversationId: '3', searchableText: 'Write unit tests with Jest' },
      { conversationId: '4', searchableText: 'Debug the React component' },
    ];

    const clusters = clusterByTopic(conversations);

    // Should have authentication, testing, and frontend/debugging clusters
    expect(clusters.length).toBeGreaterThanOrEqual(2);

    // Find auth cluster
    const authCluster = clusters.find(c => c.topic === 'authentication');
    expect(authCluster).toBeDefined();
    expect(authCluster!.conversationCount).toBe(2);
  });

  it('should include key terms in clusters', () => {
    const conversations = [
      { conversationId: '1', searchableText: 'SQL query for PostgreSQL' },
      { conversationId: '2', searchableText: 'PostgreSQL database migration' },
    ];

    const clusters = clusterByTopic(conversations);
    const dbCluster = clusters.find(c => c.topic === 'database');

    expect(dbCluster).toBeDefined();
    expect(dbCluster!.keyTerms).toContain('postgresql');
  });
});

describe('getTopicDistribution', () => {
  it('should return topic counts', () => {
    const conversations = [
      { conversationId: '1', searchableText: 'React component styling' },
      { conversationId: '2', searchableText: 'Vue.js frontend' },
      { conversationId: '3', searchableText: 'SQL database query' },
    ];

    const distribution = getTopicDistribution(conversations);

    expect(distribution['frontend']).toBe(2);
    expect(distribution['database']).toBe(1);
  });
});
