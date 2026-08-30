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

  it('assigns collision-safe ids to distinct labels', async () => {
    const cafeLocation = store.resolveLocationInput('Cafe');
    expect(cafeLocation).not.toBeNull();

    if (cafeLocation) {
      store.commitLocation(cafeLocation);
    }

    const accentedCafeLocation = store.resolveLocationInput('Café');
    expect(accentedCafeLocation).not.toBeNull();
    expect(accentedCafeLocation?.id).not.toBe(cafeLocation?.id);

    if (accentedCafeLocation) {
      store.commitLocation(accentedCafeLocation);
    }

    expect(store.getKnownLocations().map((location) => location.label)).toEqual(['Cafe', 'Café', 'Home', 'Office']);
    expect(store.getUsageStatistics().map((entry) => entry.locationId).sort()).toEqual([
      'location-cafe',
      accentedCafeLocation?.id,
    ].sort());
  });

  it('reserves all explicit ids before generating ids for legacy locations without ids', async () => {
    adapter.data = {
      schemaVersion: 1,
      settings: {
        defaultLocationId: 'location-office',
        pinnedLocationIds: [],
        showPopupOnCreate: true,
        autoApplyDefaultWhenOnlyOneChoice: true,
      },
      locations: [
        { label: 'Office' },
        { id: 'location-office', label: 'Office Annex' },
      ],
      usage: [],
    } as unknown as LocationData;

    await store.load();

    expect(store.getLocationById('location-office')?.label).toBe('Office Annex');
    expect(store.getKnownLocations().find((location) => location.label === 'Office')?.id).toBe('location-office-2');
  });

  it('normalizes commit ids before lookup and prevents duplicate location ids', () => {
    const firstLocation = store.commitLocation({ id: ' custom-id ', label: 'Cafe' });
    const sameLocation = store.commitLocation({ id: ' custom-id ', label: 'Cafe' });
    const conflictingLocation = store.commitLocation({ id: 'custom-id', label: 'Gym' });

    expect(firstLocation.id).toBe('custom-id');
    expect(sameLocation.id).toBe('custom-id');
    expect(conflictingLocation.id).not.toBe('custom-id');
    expect(new Set(store.getKnownLocations().map((location) => location.id)).size).toBe(
      store.getKnownLocations().length,
    );
    expect(store.getTopRecentLocations().map((location) => location.label)).toEqual(['Cafe', 'Gym']);
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

  it('migrates malformed stored data without throwing or losing valid identities', async () => {
    adapter.data = {
      schemaVersion: 1,
      settings: {
        defaultLocationId: 42,
        pinnedLocationIds: ['legacy-valid', 7],
        showPopupOnCreate: 'yes',
        autoApplyDefaultWhenOnlyOneChoice: null,
      },
      locations: [
        { id: 'legacy-valid', label: 'Valid' },
        null,
        { id: '', label: 'Needs id' },
        { id: 'same-id', label: 'First' },
        { id: 'same-id', label: 'Second' },
        { id: 'another-id', label: ' valid ' },
      ],
      usage: [
        { locationId: 'legacy-valid', count: 2, firstSeenAt: 'not-a-date', lastUsedAt: '2026-01-02T00:00:00Z' },
        { locationId: 'missing', count: 9, firstSeenAt: '2026-01-01T00:00:00Z', lastUsedAt: '2026-01-02T00:00:00Z' },
        { locationId: 'legacy-valid', count: 'bad', firstSeenAt: '2026-01-01T00:00:00Z', lastUsedAt: '2026-01-02T00:00:00Z' },
        null,
      ],
    } as unknown as LocationData;

    await expect(store.load()).resolves.toBeUndefined();
    await store.save();

    expect(adapter.data?.locations.map((location) => location.label)).toEqual(['Valid', 'Needs id', 'First', 'Second']);
    expect(new Set(adapter.data?.locations.map((location) => location.id)).size).toBe(4);
    expect(store.getLocationById('same-id')?.label).toBe('First');
    expect(store.getKnownLocations().find((location) => location.label === 'Second')?.id).not.toBe('same-id');
    expect(store.getSettings()).toEqual({
      defaultLocationId: 'legacy-valid',
      pinnedLocationIds: ['legacy-valid'],
      showPopupOnCreate: true,
      autoApplyDefaultWhenOnlyOneChoice: true,
    });
    expect(adapter.data?.usage).toEqual([{
      locationId: 'legacy-valid',
      count: 2,
      firstSeenAt: '2026-01-02T00:00:00.000Z',
      lastUsedAt: '2026-01-02T00:00:00.000Z',
    }]);
  });

  it('remaps settings and usage references when migration normalizes an id', async () => {
    adapter.data = {
      schemaVersion: 1,
      settings: {
        defaultLocationId: ' legacy-office ',
        pinnedLocationIds: [' legacy-office '],
        showPopupOnCreate: true,
        autoApplyDefaultWhenOnlyOneChoice: true,
      },
      locations: [{ id: ' legacy-office ', label: 'Office' }],
      usage: [{
        locationId: ' legacy-office ',
        count: 3,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-01-02T00:00:00.000Z',
      }],
    } as unknown as LocationData;

    await store.load();
    await store.save();

    expect(adapter.data?.locations).toEqual([{ id: 'legacy-office', label: 'Office' }]);
    expect(store.getSettings()).toEqual({
      defaultLocationId: 'legacy-office',
      pinnedLocationIds: ['legacy-office'],
      showPopupOnCreate: true,
      autoApplyDefaultWhenOnlyOneChoice: true,
    });
    expect(adapter.data?.usage?.[0]?.locationId).toBe('legacy-office');
  });

  it('remaps duplicate-label references to the first canonical location', async () => {
    adapter.data = {
      schemaVersion: 1,
      settings: {
        defaultLocationId: 'location-office-legacy',
        pinnedLocationIds: ['location-office-legacy'],
        showPopupOnCreate: true,
        autoApplyDefaultWhenOnlyOneChoice: true,
      },
      locations: [
        { id: 'location-office', label: 'Office' },
        { id: 'location-office-legacy', label: ' office ' },
      ],
      usage: [{
        locationId: 'location-office-legacy',
        count: 4,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-01-02T00:00:00.000Z',
      }],
    };

    await store.load();
    await store.save();

    expect(adapter.data?.locations).toEqual([{ id: 'location-office', label: 'Office' }]);
    expect(store.getSettings()).toEqual({
      defaultLocationId: 'location-office',
      pinnedLocationIds: ['location-office'],
      showPopupOnCreate: true,
      autoApplyDefaultWhenOnlyOneChoice: true,
    });
    expect(adapter.data?.usage).toEqual([{
      locationId: 'location-office',
      count: 4,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-02T00:00:00.000Z',
    }]);
  });

  it('falls back to defaults for a non-object payload', async () => {
    adapter.data = 'corrupt' as unknown as LocationData;

    await expect(store.load()).resolves.toBeUndefined();

    expect(store.getKnownLocations().map((location) => location.label)).toEqual(['Home', 'Office']);
    expect(store.getSettings().defaultLocationId).toBe('location-office');
  });

  it('falls back to defaults for an unsupported schema version', async () => {
    adapter.data = { schemaVersion: 99 } as unknown as LocationData;

    await expect(store.load()).resolves.toBeUndefined();

    expect(store.getKnownLocations().map((location) => location.label)).toEqual(['Home', 'Office']);
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

  it('preserves lastUsedAt when reconcile only refreshes the count snapshot', async () => {
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
        count: 1,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-01-02T00:00:00.000Z',
      }],
    };
    await store.load();

    expect(store.reconcileVaultUsage([{ label: 'Office', count: 4 }])).toBe(true);
    await store.save();

    expect(adapter.data?.usage).toEqual([{
      locationId: 'location-office',
      count: 4,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-02T00:00:00.000Z',
    }]);
    expect(store.reconcileVaultUsage([{ label: 'Office', count: 4 }])).toBe(false);
  });

  it('initializes lastUsedAt for usage first discovered during reconcile', async () => {
    expect(store.reconcileVaultUsage([{ label: 'Cafe', count: 1 }])).toBe(true);
    await store.save();

    expect(adapter.data?.usage).toEqual([{
      locationId: 'location-cafe',
      count: 1,
      firstSeenAt: '2026-06-21T10:00:00.000Z',
      lastUsedAt: '2026-06-21T10:00:00.000Z',
    }]);
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
