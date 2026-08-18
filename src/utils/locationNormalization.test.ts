import { describe, expect, it } from 'vitest';
import {
  createLocationId,
  dedupeLocationsByKey,
  formatLocationFrontmatterValue,
  matchesLocationQuery,
  normalizeLocationKey,
  normalizeLocationLabel,
} from './locationNormalization';

describe('locationNormalization', () => {
  it('unwraps wiki links and trims whitespace', () => {
    expect(normalizeLocationLabel('  [[Home|Home base]]  ')).toBe('Home');
  });

  it('normalizes keys case-insensitively', () => {
    expect(normalizeLocationKey('Office')).toBe(normalizeLocationKey(' office '));
  });

  it('creates stable ids from Unicode labels', () => {
    expect(createLocationId('Home')).toBe('location-home');
  });

  it('formats frontmatter as a wiki link', () => {
    expect(formatLocationFrontmatterValue('Office')).toBe('[[Office]]');
  });

  it('deduplicates locations by normalized label', () => {
    expect(
      dedupeLocationsByKey([
        { id: 'location-office', label: 'Office' },
        { id: 'location-office-2', label: ' office ' },
        { id: 'location-home', label: 'Home' },
      ]),
    ).toEqual([
      { id: 'location-office', label: 'Office' },
      { id: 'location-home', label: 'Home' },
    ]);
  });

  it('matches partial queries against the label', () => {
    expect(matchesLocationQuery({ id: 'location-office', label: 'Office' }, 'off')).toBe(true);
    expect(matchesLocationQuery({ id: 'location-office', label: 'Office' }, 'gym')).toBe(false);
  });
});
