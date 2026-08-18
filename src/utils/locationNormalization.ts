import type { LocationDefinition } from '../types';

export function normalizeLocationLabel(rawValue: string): string {
  const trimmedValue = rawValue.trim();
  if (!trimmedValue) {
    return '';
  }

  const wikiLinkMatch = /^\[\[(.+?)\]\]$/.exec(trimmedValue);
  const unwrappedValue = wikiLinkMatch ? wikiLinkMatch[1].split('|')[0].trim() : trimmedValue;

  return unwrappedValue.replace(/\s+/g, ' ');
}

export function normalizeLocationKey(rawValue: string): string {
  return normalizeLocationLabel(rawValue).toLocaleLowerCase();
}

export function createLocationId(rawValue: string): string {
  const normalizedValue = normalizeLocationLabel(rawValue)
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return normalizedValue ? `location-${normalizedValue}` : 'location-unknown';
}

export function formatLocationFrontmatterValue(label: string): string {
  return `[[${label}]]`;
}

export function dedupeLocationsByKey(locations: LocationDefinition[]): LocationDefinition[] {
  const seenKeys = new Set<string>();
  const dedupedLocations: LocationDefinition[] = [];

  for (const location of locations) {
    const normalizedKey = normalizeLocationKey(location.label);
    if (!normalizedKey || seenKeys.has(normalizedKey)) {
      continue;
    }

    seenKeys.add(normalizedKey);
    dedupedLocations.push(location);
  }

  return dedupedLocations;
}

export function matchesLocationQuery(location: LocationDefinition, query: string): boolean {
  const normalizedQuery = normalizeLocationKey(query);
  if (!normalizedQuery) {
    return true;
  }

  return normalizeLocationKey(location.label).includes(normalizedQuery);
}
