import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseTimeRange, isTimeExpression } from './time-parser.js';

describe('parseTimeRange', () => {
  beforeEach(() => {
    // Mock date to 2026-01-07 (Wednesday)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-07T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('yesterday', () => {
    it('should return yesterday date', () => {
      const result = parseTimeRange('yesterday');
      expect(result).toEqual({
        startDate: '2026-01-06',
        endDate: '2026-01-06',
      });
    });
  });

  describe('today', () => {
    it('should return today date', () => {
      const result = parseTimeRange('today');
      expect(result).toEqual({
        startDate: '2026-01-07',
        endDate: '2026-01-07',
      });
    });
  });

  describe('this week', () => {
    it('should return Monday to today', () => {
      const result = parseTimeRange('this week');
      expect(result).toEqual({
        startDate: '2026-01-05', // Monday
        endDate: '2026-01-07',   // Wednesday (today)
      });
    });
  });

  describe('last week', () => {
    it('should return previous Monday to Sunday', () => {
      const result = parseTimeRange('last week');
      expect(result).toEqual({
        startDate: '2025-12-29', // Previous Monday
        endDate: '2026-01-04',   // Previous Sunday
      });
    });
  });

  describe('this month', () => {
    it('should return 1st of month to today', () => {
      const result = parseTimeRange('this month');
      expect(result).toEqual({
        startDate: '2026-01-01',
        endDate: '2026-01-07',
      });
    });
  });

  describe('last month', () => {
    it('should return full previous month', () => {
      const result = parseTimeRange('last month');
      expect(result).toEqual({
        startDate: '2025-12-01',
        endDate: '2025-12-31',
      });
    });
  });

  describe('last N days', () => {
    it('should parse "last 3 days"', () => {
      const result = parseTimeRange('last 3 days');
      expect(result).toEqual({
        startDate: '2026-01-04',
        endDate: '2026-01-07',
      });
    });

    it('should parse "past 7 days"', () => {
      const result = parseTimeRange('past 7 days');
      expect(result).toEqual({
        startDate: '2025-12-31',
        endDate: '2026-01-07',
      });
    });

    it('should parse "last 1 day"', () => {
      const result = parseTimeRange('last 1 day');
      expect(result).toEqual({
        startDate: '2026-01-06',
        endDate: '2026-01-07',
      });
    });
  });

  describe('last N weeks', () => {
    it('should parse "last 2 weeks"', () => {
      const result = parseTimeRange('last 2 weeks');
      expect(result).toEqual({
        startDate: '2025-12-24',
        endDate: '2026-01-07',
      });
    });

    it('should parse "past 1 week"', () => {
      const result = parseTimeRange('past 1 week');
      expect(result).toEqual({
        startDate: '2025-12-31',
        endDate: '2026-01-07',
      });
    });
  });

  describe('last N months', () => {
    it('should parse "last 3 months"', () => {
      const result = parseTimeRange('last 3 months');
      expect(result).toEqual({
        startDate: '2025-10-07',
        endDate: '2026-01-07',
      });
    });
  });

  describe('unrecognized expressions', () => {
    it('should return null for invalid expressions', () => {
      expect(parseTimeRange('next week')).toBeNull();
      expect(parseTimeRange('random text')).toBeNull();
      expect(parseTimeRange('')).toBeNull();
      expect(parseTimeRange('2026-01-01')).toBeNull(); // Raw date not supported
    });
  });
});

describe('isTimeExpression', () => {
  it('should recognize valid time expressions', () => {
    expect(isTimeExpression('yesterday')).toBe(true);
    expect(isTimeExpression('today')).toBe(true);
    expect(isTimeExpression('this week')).toBe(true);
    expect(isTimeExpression('last week')).toBe(true);
    expect(isTimeExpression('this month')).toBe(true);
    expect(isTimeExpression('last month')).toBe(true);
    expect(isTimeExpression('last 3 days')).toBe(true);
    expect(isTimeExpression('past 7 days')).toBe(true);
    expect(isTimeExpression('last 2 weeks')).toBe(true);
    expect(isTimeExpression('past 1 month')).toBe(true);
  });

  it('should reject invalid expressions', () => {
    expect(isTimeExpression('next week')).toBe(false);
    expect(isTimeExpression('random')).toBe(false);
    expect(isTimeExpression('2026-01-01')).toBe(false);
    expect(isTimeExpression('')).toBe(false);
  });

  it('should be case insensitive', () => {
    expect(isTimeExpression('YESTERDAY')).toBe(true);
    expect(isTimeExpression('Last Week')).toBe(true);
    expect(isTimeExpression('LAST 3 DAYS')).toBe(true);
  });
});
