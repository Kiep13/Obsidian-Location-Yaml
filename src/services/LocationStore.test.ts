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

  it('does not inject default locations into loaded user data', async () => {
    adapter.data = {
      schemaVersion: 1,
      settings: {
        defaultLocationId: 'location-cafe',
        pinnedLocationIds: [],
        showPopupOnCreate: true,
        autoApplyDefaultWhenOnlyOneChoice: true,
      },
      locations: [{ id: 'location-cafe', label: 'Cafe' }],
      usage: [],
    };
    await store.load();

    expect(store.getKnownLocations().map((location) => location.label)).toEqual(['Cafe']);
    expect(store.getDefaultLocation()?.label).toBe('Cafe');
  });

  it('reconciles usage from current vault labels without merging distinct labels', async () => {
    adapter.data = {
      schemaVersion: 1,
      settings: {
        defaultLocationId: 'location-office',
        pinnedLocationIds: [],
        showPopupOnCreate: true,
        autoApplyDefaultWhenOnlyOneChoice: true,
      },
      locations: [{ id: 'location-office', label: 'Office' }],
      usage: [{
        locationId: 'location-office',
        count: 99,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-01-02T00:00:00.000Z',
      }],
    };
    await store.load();

    expect(store.reconcileVaultUsage([
      { label: 'Office', count: 2 },
      { label: 'City, Main Street 26', count: 3 },
      { label: 'Main Street 26, City', count: 1 },
    ])).toBe(true);
    await store.save();

    expect(adapter.data?.locations.map((location) => location.label)).toEqual([
      'Office',
      'City, Main Street 26',
      'Main Street 26, City',
    ]);
    expect(adapter.data?.usage.map((entry) => [
      store.getLocationById(entry.locationId)?.label,
      entry.count,
    ])).toEqual([
      ['Office', 2],
      ['City, Main Street 26', 3],
      ['Main Street 26, City', 1],
    ]);
  });

  it('removes usage for locations no longer present in the vault', async () => {
    const officeLocation = store.resolveLocationInput('Office');
    expect(officeLocation).not.toBeNull();

    if (officeLocation) {
      store.commitLocation(officeLocation);
    }

    expect(store.reconcileVaultUsage([])).toBe(true);
    expect(store.getTopRecentLocations()).toEqual([]);
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

  it('returns used locations for statistics by count and then label', () => {
    expect(store.reconcileVaultUsage([
      { label: 'Zoo', count: 2 },
      { label: 'Alpha', count: 2 },
      { label: 'Unused', count: 0 },
      { label: 'Cafe', count: 4 },
    ])).toBe(true);

    expect(store.getUsageStatistics()).toEqual([
      expect.objectContaining({ label: 'Cafe', count: 4 }),
      expect.objectContaining({ label: 'Alpha', count: 2 }),
      expect.objectContaining({ label: 'Zoo', count: 2 }),
    ]);
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
