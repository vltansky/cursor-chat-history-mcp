/**
 * Quality scoring for conversations
 * Uses heuristics to score conversations by usefulness/value
 */

export interface QualityFactors {
  hasCodeBlocks: boolean;
  codeBlockCount: number;
  hasAssistantResponse: boolean;
  hasSolutionIndicators: boolean;
  hasOngoingProblems: boolean;
  hasFileReferences: boolean;
  fileReferenceCount: number;
  hasGitLink: boolean;
  messageCount: number;
  conversationDepth: 'shallow' | 'medium' | 'deep';
}

export interface QualityScore {
  score: number; // 0-100
  factors: QualityFactors;
  breakdown: {
    codeBlocks: number;
    assistantResponse: number;
    solutionIndicators: number;
    ongoingProblems: number;
    fileReferences: number;
    gitLink: number;
    conversationDepth: number;
  };
}

// Patterns indicating a solution was found
const SOLUTION_PATTERNS = [
  /\b(fixed|works|solved|resolved|done|success|working)\b/i,
  /\b(that('?s| is) (it|correct|right))\b/i,
  /\b(perfect|excellent|great|thanks)\b/i,
  /\bthanks?,? (that|it) (worked|fixed|solved)/i,
  /\bproblem solved\b/i,
  /\bissue (is )?fixed\b/i,
];

// Patterns indicating ongoing problems (negative signal - reduces score)
const PROBLEM_PATTERNS = [
  /\b(still (not working|broken|failing))\b/i,
  /\b(doesn'?t work|not working)\b/i,
];

/**
 * Calculate quality score for a conversation
 */
export function calculateQualityScore(conversation: {
  messageCount: number;
  hasCodeBlocks: boolean;
  codeBlockCount?: number;
  relevantFiles?: string[];
  attachedFolders?: string[];
  messages?: Array<{ type: number; text: string }>;
  searchableText?: string;
  linkedCommits?: string[];
}): QualityScore {
  const factors: QualityFactors = {
    hasCodeBlocks: conversation.hasCodeBlocks,
    codeBlockCount: conversation.codeBlockCount ?? 0,
    hasAssistantResponse: false,
    hasSolutionIndicators: false,
    hasOngoingProblems: false,
    hasFileReferences: (conversation.relevantFiles?.length ?? 0) > 0,
    fileReferenceCount: conversation.relevantFiles?.length ?? 0,
    hasGitLink: (conversation.linkedCommits?.length ?? 0) > 0,
    messageCount: conversation.messageCount,
    conversationDepth: getConversationDepth(conversation.messageCount),
  };

  // Check for assistant responses
  if (conversation.messages) {
    factors.hasAssistantResponse = conversation.messages.some(m => m.type === 2);
  }

  // Check for solution indicators in searchable text or messages
  const textToCheck = conversation.searchableText ??
    conversation.messages?.map(m => m.text).join(' ') ?? '';

  factors.hasSolutionIndicators = SOLUTION_PATTERNS.some(pattern => pattern.test(textToCheck));
  factors.hasOngoingProblems = PROBLEM_PATTERNS.some(pattern => pattern.test(textToCheck));

  // Calculate breakdown scores
  const breakdown = {
    codeBlocks: 0,
    assistantResponse: 0,
    solutionIndicators: 0,
    ongoingProblems: 0,
    fileReferences: 0,
    gitLink: 0,
    conversationDepth: 0,
  };

  // Code blocks: up to 20 points
  if (factors.hasCodeBlocks) {
    breakdown.codeBlocks = Math.min(20, 10 + factors.codeBlockCount * 2);
  }

  // Assistant response: 20 points
  if (factors.hasAssistantResponse) {
    breakdown.assistantResponse = 20;
  }

  // Solution indicators: 25 points
  if (factors.hasSolutionIndicators) {
    breakdown.solutionIndicators = 25;
  }

  // Ongoing problems: -10 points (negative signal - conversation not resolved)
  if (factors.hasOngoingProblems) {
    breakdown.ongoingProblems = -10;
  }

  // File references: up to 15 points
  if (factors.hasFileReferences) {
    breakdown.fileReferences = Math.min(15, 5 + factors.fileReferenceCount * 2);
  }

  // Git link: 10 points
  if (factors.hasGitLink) {
    breakdown.gitLink = 10;
  }

  // Conversation depth: up to 10 points
  switch (factors.conversationDepth) {
    case 'deep':
      breakdown.conversationDepth = 10;
      break;
    case 'medium':
      breakdown.conversationDepth = 7;
      break;
    case 'shallow':
      breakdown.conversationDepth = 3;
      break;
  }

  // Calculate total score (min 0, max 100)
  const score = Math.max(0, Math.min(100,
    breakdown.codeBlocks +
    breakdown.assistantResponse +
    breakdown.solutionIndicators +
    breakdown.ongoingProblems +
    breakdown.fileReferences +
    breakdown.gitLink +
    breakdown.conversationDepth
  ));

  return { score, factors, breakdown };
}

/**
 * Get conversation depth category based on message count
 */
function getConversationDepth(messageCount: number): 'shallow' | 'medium' | 'deep' {
  if (messageCount >= 10) return 'deep';
  if (messageCount >= 4) return 'medium';
  return 'shallow';
}

/**
 * Quick quality check for filtering (faster than full score)
 */
export function meetsQualityThreshold(
  conversation: Parameters<typeof calculateQualityScore>[0],
  minScore: number
): boolean {
  // Fast path: if minScore is 0, always pass
  if (minScore <= 0) return true;

  // Quick heuristic check before full calculation
  const quickScore =
    (conversation.hasCodeBlocks ? 20 : 0) +
    (conversation.messageCount >= 4 ? 20 : 0) +
    ((conversation.relevantFiles?.length ?? 0) > 0 ? 10 : 0);

  // If quick score can't possibly meet threshold, skip full calculation
  if (quickScore + 50 < minScore) return false;

  // Full calculation for edge cases
  const { score } = calculateQualityScore(conversation);
  return score >= minScore;
}
