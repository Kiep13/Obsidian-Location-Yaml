import { describe, expect, it } from 'vitest';
import { App, type MockElement } from 'obsidian';
import type { LocationUsageStatistic } from '../types';
import { LocationStatisticsModal } from './LocationStatisticsModal';

function getText(element: MockElement): string {
  return [element.textContent, ...element.children.map((child) => getText(child))].join(' ');
}

function findButtonMatch(element: MockElement, text: string): MockElement | null {
  if (element.tagName === 'button' && getText(element).includes(text)) {
    return element;
  }

  for (const child of element.children) {
    const match = findButtonMatch(child, text);
    if (match) {
      return match;
    }
  }

  return null;
}

function findButton(element: MockElement, text: string): MockElement {
  const match = findButtonMatch(element, text);
  if (match) {
    return match;
  }

  throw new Error(`Button not found: ${text}`);
}

function findElementWithText(element: MockElement, text: string): MockElement {
  if (element.tagName === 'li' && getText(element).includes(text)) {
    return element;
  }

  for (const child of element.children) {
    try {
      return findElementWithText(child, text);
    } catch {
      continue;
    }
  }

  throw new Error(`Element not found: ${text}`);
}

function findByClass(element: MockElement, className: string): MockElement {
  if (element.hasClass(className)) {
    return element;
  }

  for (const child of element.children) {
    try {
      return findByClass(child, className);
    } catch {
      continue;
    }
  }

  throw new Error(`Element not found: ${className}`);
}

function buildStatistics(count: number): LocationUsageStatistic[] {
  return Array.from({ length: count }, (unusedValue, index) => {
    void unusedValue;
    const number = index + 1;
    return {
      locationId: `location-${number}`,
      label: `Location ${String(number).padStart(2, '0')}`,
      count: count - index,
    };
  });
}

describe('LocationStatisticsModal', () => {
  it('renders the top eight locations and an Other segment with percentages', () => {
    const modal = new LocationStatisticsModal(new App(), buildStatistics(10));
    modal.onOpen();

    const text = getText(modal.contentEl);
    expect(text).toContain('Location 08');
    expect(text).toContain('Other');
    expect(text).toContain('55 location assignments');
    expect(text).toContain('18.2%');
  });

  it('renders a non-interactive unordered list', () => {
    const modal = new LocationStatisticsModal(new App(), buildStatistics(10));
    modal.onOpen();

    expect(() => findButton(modal.contentEl, 'Other')).toThrow();

    const otherItem = findElementWithText(modal.contentEl, 'Other');
    expect(otherItem.hasClass('location-statistics-legend-item')).toBe(true);
  });

  it('shows the selected location when a donut segment is clicked', () => {
    const modal = new LocationStatisticsModal(new App(), buildStatistics(3));
    modal.onOpen();

    findByClass(modal.contentEl, 'location-statistics-donut-segment').click();

    expect(findElementWithText(modal.contentEl, 'Location 01').hasClass('is-selected')).toBe(true);
    expect(findElementWithText(modal.contentEl, 'Location 02').hasClass('is-selected')).toBe(false);
  });

  it('labels SVG segments as location assignments', () => {
    const modal = new LocationStatisticsModal(new App(), buildStatistics(2));
    modal.onOpen();

    const segment = findByClass(modal.contentEl, 'location-statistics-donut-segment');

    expect(segment.style['aria-label']).toContain('location assignments');
    expect(segment.style['aria-label']).not.toContain('notes');
  });

  it('does not render the table', () => {
    const modal = new LocationStatisticsModal(new App(), buildStatistics(11));
    modal.onOpen();

    expect(() => findByClass(modal.contentEl, 'location-statistics-table')).toThrow();
  });

  it('renders an empty state without location usage', () => {
    const modal = new LocationStatisticsModal(new App(), []);
    modal.onOpen();

    expect(getText(modal.contentEl)).toContain('No notes with a location yet.');
  });
});
