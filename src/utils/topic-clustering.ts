/**
 * Topic clustering for conversations
 * Groups conversations by detected themes using keyword extraction
 */

/**
 * Pre-defined topic categories with associated keywords
 * Single regex per topic for simplicity - add more patterns by extending the alternation
 */
const TOPIC_PATTERNS: Record<string, RegExp> = {
  'authentication': /\b(auth|login|logout|signin|signout|password|jwt|token|oauth|session|2fa|mfa)\b/i,
  'database': /\b(database|sql|query|postgresql|postgres|mysql|mongodb|sqlite|prisma|drizzle|orm|migration|schema)\b/i,
  'api': /\b(api|rest|graphql|endpoint|route|fetch|axios|request|response|http|webhook)\b/i,
  'frontend': /\b(react|vue|angular|svelte|nextjs|component|jsx|tsx|css|tailwind|styling|ui|ux)\b/i,
  'testing': /\b(test|testing|jest|vitest|mocha|cypress|playwright|spec|mock|fixture|coverage)\b/i,
  'deployment': /\b(deploy|deployment|docker|kubernetes|k8s|ci|cd|pipeline|vercel|aws|gcp|azure|hosting)\b/i,
  'performance': /\b(performance|optimize|optimization|cache|caching|lazy|bundle|memory|speed|slow|fast)\b/i,
  'debugging': /\b(debug|error|exception|crash|bug|fix|issue|problem|trace|stack|log)\b/i,
  'refactoring': /\b(refactor|restructure|cleanup|clean up|improve|simplify|extract|rename|move)\b/i,
  'configuration': /\b(config|configuration|setup|install|env|environment|settings|options)\b/i,
  'typescript': /\b(typescript|ts|type|interface|generic|typing|typed)\b/i,
  'git': /\b(git|commit|merge|branch|rebase|push|pull|conflict|diff)\b/i,
  'security': /\b(security|secure|vulnerability|xss|csrf|injection|sanitize|encrypt|decrypt)\b/i,
  'state-management': /\b(state|redux|zustand|recoil|mobx|context|provider|store)\b/i,
};

export interface TopicMatch {
  topic: string;
  score: number; // Number of pattern matches
  matchedTerms: string[];
}

export interface TopicCluster {
  topic: string;
  conversationCount: number;
  conversationIds: string[];
  keyTerms: string[];
}

/**
 * Detect topics in a text
 */
export function detectTopics(text: string): TopicMatch[] {
  const matches: TopicMatch[] = [];

  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
    const globalPattern = new RegExp(pattern.source, 'gi');
    const textMatches = text.match(globalPattern);

    if (textMatches && textMatches.length > 0) {
      const uniqueTerms = [...new Set(textMatches.map(m => m.toLowerCase()))];
      matches.push({
        topic,
        score: textMatches.length,
        matchedTerms: uniqueTerms,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches;
}

/**
 * Get primary topic for a conversation
 */
export function getPrimaryTopic(text: string): string {
  const topics = detectTopics(text);
  return topics.length > 0 ? topics[0].topic : 'general';
}

/**
 * Cluster conversations by topic
 */
export function clusterByTopic(
  conversations: Array<{
    conversationId: string;
    searchableText: string;
  }>
): TopicCluster[] {
  const clusterMap = new Map<string, {
    conversationIds: string[];
    allTerms: string[];
  }>();

  for (const conv of conversations) {
    const topics = detectTopics(conv.searchableText);
    const primaryTopic = topics.length > 0 ? topics[0].topic : 'general';

    if (!clusterMap.has(primaryTopic)) {
      clusterMap.set(primaryTopic, { conversationIds: [], allTerms: [] });
    }

    const cluster = clusterMap.get(primaryTopic)!;
    cluster.conversationIds.push(conv.conversationId);

    // Collect top matched terms
    if (topics.length > 0) {
      cluster.allTerms.push(...topics[0].matchedTerms);
    }
  }

  // Convert to array and compute key terms
  const clusters: TopicCluster[] = [];

  for (const [topic, data] of clusterMap) {
    // Count term frequency
    const termCounts = new Map<string, number>();
    for (const term of data.allTerms) {
      termCounts.set(term, (termCounts.get(term) || 0) + 1);
    }

    // Get top 5 terms by frequency
    const keyTerms = [...termCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term]) => term);

    clusters.push({
      topic,
      conversationCount: data.conversationIds.length,
      conversationIds: data.conversationIds,
      keyTerms,
    });
  }

  // Sort by conversation count descending
  clusters.sort((a, b) => b.conversationCount - a.conversationCount);

  return clusters;
}

/**
 * Get topic distribution for conversations
 */
export function getTopicDistribution(
  conversations: Array<{
    conversationId: string;
    searchableText: string;
  }>
): Record<string, number> {
  const distribution: Record<string, number> = {};

  for (const conv of conversations) {
    const topics = detectTopics(conv.searchableText);
    const primaryTopic = topics.length > 0 ? topics[0].topic : 'general';
    distribution[primaryTopic] = (distribution[primaryTopic] || 0) + 1;
  }

  return distribution;
}
