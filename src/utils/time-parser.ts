/**
 * Natural language time range parser
 * Converts expressions like "last week", "yesterday" to date ranges
 */

export interface TimeRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

/**
 * Parse a natural language time expression to a date range
 * Returns null if the expression is not recognized
 */
export function parseTimeRange(expression: string): TimeRange | null {
  const now = new Date();
  const today = startOfDay(now);
  const expr = expression.toLowerCase().trim();

  // Yesterday
  if (expr === 'yesterday') {
    const yesterday = addDays(today, -1);
    return {
      startDate: formatDate(yesterday),
      endDate: formatDate(yesterday),
    };
  }

  // Today
  if (expr === 'today') {
    return {
      startDate: formatDate(today),
      endDate: formatDate(today),
    };
  }

  // This week (Monday to today)
  if (expr === 'this week') {
    const startOfWeek = getStartOfWeek(today);
    return {
      startDate: formatDate(startOfWeek),
      endDate: formatDate(today),
    };
  }

  // Last week (previous Monday to Sunday)
  if (expr === 'last week') {
    const thisWeekStart = getStartOfWeek(today);
    const lastWeekStart = addDays(thisWeekStart, -7);
    const lastWeekEnd = addDays(thisWeekStart, -1);
    return {
      startDate: formatDate(lastWeekStart),
      endDate: formatDate(lastWeekEnd),
    };
  }

  // This month (1st to today)
  if (expr === 'this month') {
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      startDate: formatDate(startOfMonth),
      endDate: formatDate(today),
    };
  }

  // Last month
  if (expr === 'last month') {
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    return {
      startDate: formatDate(lastMonthStart),
      endDate: formatDate(lastMonthEnd),
    };
  }

  // "last N days" / "past N days"
  const lastDaysMatch = expr.match(/^(?:last|past)\s+(\d+)\s*days?$/);
  if (lastDaysMatch) {
    const days = parseInt(lastDaysMatch[1], 10);
    const startDate = addDays(today, -days);
    return {
      startDate: formatDate(startDate),
      endDate: formatDate(today),
    };
  }

  // "last N weeks" / "past N weeks"
  const lastWeeksMatch = expr.match(/^(?:last|past)\s+(\d+)\s*weeks?$/);
  if (lastWeeksMatch) {
    const weeks = parseInt(lastWeeksMatch[1], 10);
    const startDate = addDays(today, -weeks * 7);
    return {
      startDate: formatDate(startDate),
      endDate: formatDate(today),
    };
  }

  // "last N months" / "past N months"
  const lastMonthsMatch = expr.match(/^(?:last|past)\s+(\d+)\s*months?$/);
  if (lastMonthsMatch) {
    const months = parseInt(lastMonthsMatch[1], 10);
    const startDate = new Date(today.getFullYear(), today.getMonth() - months, today.getDate());
    return {
      startDate: formatDate(startDate),
      endDate: formatDate(today),
    };
  }

  // Not recognized
  return null;
}

/**
 * Check if a string looks like a natural time expression
 */
export function isTimeExpression(str: string): boolean {
  const expr = str.toLowerCase().trim();

  const patterns = [
    /^yesterday$/,
    /^today$/,
    /^this\s+(?:week|month)$/,
    /^last\s+(?:week|month)$/,
    /^(?:last|past)\s+\d+\s*(?:days?|weeks?|months?)$/,
  ];

  return patterns.some(pattern => pattern.test(expr));
}

// Helper functions

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getStartOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  // Adjust to Monday (day 1), if Sunday (day 0), go back 6 days
  const diff = day === 0 ? 6 : day - 1;
  result.setDate(result.getDate() - diff);
  return result;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
