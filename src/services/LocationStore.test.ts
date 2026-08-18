import { beforeEach, describe, expect, it } from 'vitest';
import { LocationStore } from './LocationStore';
import type { LocationData, LocationDataAdapter } from '../types';

class MemoryAdapter implements LocationDataAdapter {
  public data: LocationData | null = null;

  public async load(): Promise<LocationData | null> {
    return this.data;
  }

  public async save(data: LocationData): Promise<void> {
    this.data = JSON.parse(JSON.stringify(data)) as LocationData;
  }
}

describe('LocationStore', () => {
  let adapter: MemoryAdapter;
  let store: LocationStore;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    store = new LocationStore(adapter, () => new Date('2026-06-21T10:00:00Z'));
    await store.load();
  });

  it('reuses existing locations instead of creating duplicates', async () => {
    const officeLocation = store.resolveLocationInput('Office');
    const sameOfficeLocation = store.resolveLocationInput('[[office]]');

    expect(officeLocation).not.toBeNull();
    expect(sameOfficeLocation).not.toBeNull();
    expect(officeLocation?.id).toBe(sameOfficeLocation?.id);

    if (officeLocation) {
      store.commitLocation(officeLocation);
    }
    if (sameOfficeLocation) {
      store.commitLocation(sameOfficeLocation);
    }
    await store.save();

    const savedOffice = adapter.data?.locations.find((location) => location.id === 'location-office');
    const officeUsage = adapter.data?.usage.find((entry) => entry.locationId === 'location-office');
    expect(savedOffice?.label).toBe('Office');
    expect(officeUsage?.count).toBe(2);
  });

  it('adds new user locations through settings updates', async () => {
    store.updateSettingsFromLabels('Cafe', true, false);
    await store.save();

    expect(store.getSettingsLabels()).toEqual({
      defaultLocation: 'Cafe',
      pinnedLocations: [],
    });

    const locationLabels = adapter.data?.locations.map((location) => location.label).sort();
    expect(locationLabels).toEqual(['Cafe', 'Home', 'Office']);
  });

  it('returns recent locations ordered by usage count', async () => {
    const gymLocation = store.resolveLocationInput('Gym');
    const cafeLocation = store.resolveLocationInput('Cafe');

    if (gymLocation) {
      store.commitLocation(gymLocation);
      store.commitLocation(gymLocation);
    }

    if (cafeLocation) {
      store.commitLocation(cafeLocation);
    }

    const recentLocations = store.getTopRecentLocations(2);
    expect(recentLocations.map((location) => location.label)).toEqual(['Gym', 'Cafe']);
  });

  it('prefers the last used location in the prompt context default', () => {
    const gymLocation = store.resolveLocationInput('Gym');
    expect(gymLocation).not.toBeNull();

    if (gymLocation) {
      store.commitLocation(gymLocation);
    }

    const promptContext = store.getPromptContext('Notes/new-note.md');
    expect(promptContext.defaultLocation?.label).toBe('Gym');
  });

  it('pins only the last committed location', () => {
    const gymLocation = store.resolveLocationInput('Gym');
    const cafeLocation = store.resolveLocationInput('Cafe');

    if (gymLocation) {
      store.commitLocation(gymLocation);
    }
    if (cafeLocation) {
      store.commitLocation(cafeLocation);
    }

    expect(store.getPinnedLocations().map((location) => location.label)).toEqual(['Cafe']);
  });
});
