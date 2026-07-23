import { describe, expect, it } from 'vitest';
import { normalizeBio, normalizePortfolio } from './portfolio';

describe('normalizePortfolio', () => {
  it('keeps valid photo and video urls', () => {
    expect(
      normalizePortfolio([
        { type: 'photo', url: 'https://cdn.example/a.jpg', caption: 'nails' },
        { type: 'video', url: 'https://youtu.be/abc123' },
        { type: 'photo', url: 'not-a-url' },
        { type: 'gif', url: 'https://cdn.example/x.gif' },
      ])
    ).toEqual([
      { type: 'photo', url: 'https://cdn.example/a.jpg', caption: 'nails' },
      { type: 'video', url: 'https://youtu.be/abc123' },
    ]);
  });

  it('returns empty for invalid input', () => {
    expect(normalizePortfolio(null)).toEqual([]);
    expect(normalizePortfolio('x')).toEqual([]);
  });
});

describe('normalizeBio', () => {
  it('trims and empties to null', () => {
    expect(normalizeBio('  hello  ')).toBe('hello');
    expect(normalizeBio('   ')).toBeNull();
    expect(normalizeBio(12)).toBeNull();
  });
});
