import type { LocationData } from './types';

export const PLUGIN_ID = 'obsidian-location';
export const PLUGIN_NAME = 'Obsidian Location';
export const LOCATION_FRONTMATTER_FIELD = 'location';
export const DEFAULT_RECENT_LIMIT = 5;
export const NEW_NOTE_PROMPT_WINDOW_MS = 10 * 60 * 1000;

export const DEFAULT_DATA: LocationData = {
  schemaVersion: 1,
  settings: {
    defaultLocationId: 'location-office',
    pinnedLocationIds: ['location-home'],
    showPopupOnCreate: true,
    autoApplyDefaultWhenOnlyOneChoice: true,
  },
  locations: [
    { id: 'location-office', label: 'Office' },
    { id: 'location-home', label: 'Home' },
  ],
  usage: [],
};
