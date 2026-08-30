import type { LocationDefinition } from '../types';

export function normalizeLocationLabel(rawValue: string): string {
  const trimmedValue = rawValue.trim();
  if (!trimmedValue) {
    return '';
  }

  const wikiLinkMatch = /^\[\[(.+?)\]\]$/.exec(trimmedValue);
  const unwrappedValue = wikiLinkMatch ? wikiLinkMatch[1].split('|')[0].trim() : trimmedValue;

  return unwrappedValue.replace(/\s+/g, ' ').normalize('NFC');
}

export function normalizeLocationKey(rawValue: string): string {
  return normalizeLocationLabel(rawValue).toLocaleLowerCase();
}

export function normalizeLocationId(rawValue: string): string {
  return rawValue.trim().normalize('NFC');
}

export function createLocationId(rawValue: string): string {
  const normalizedLabel = normalizeLocationLabel(rawValue);
  if (!normalizedLabel) {
    return 'location-unknown';
  }

  const normalizedValue = normalizedLabel
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalizedValue) {
    return `location-unknown-${encodeLocationKey(normalizedLabel.toLocaleLowerCase())}`;
  }

  const normalizedKey = normalizedLabel.toLocaleLowerCase();
  const isLosslessSlug = normalizedValue === normalizedKey;
  return isLosslessSlug
    ? `location-${normalizedValue}`
    : `location-${normalizedValue}-${encodeLocationKey(normalizedKey)}`;
}

function encodeLocationKey(value: string): string {
  return [...value]
    .map((character) => (character.codePointAt(0) ?? 0).toString(16))
    .join('_');
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
