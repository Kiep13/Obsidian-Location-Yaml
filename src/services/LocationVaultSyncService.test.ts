import { beforeEach, describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import { LocationStore } from './LocationStore';
import { LocationVaultSyncService } from './LocationVaultSyncService';
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

describe('LocationVaultSyncService', () => {
  let app: App;
  let adapter: MemoryAdapter;
  let store: LocationStore;
  let service: LocationVaultSyncService;

  beforeEach(async () => {
    app = new App();
    adapter = new MemoryAdapter();
    store = new LocationStore(adapter, () => new Date('2026-08-24T12:00:00.000Z'));
    await store.load();
    service = new LocationVaultSyncService(app, store);
  });

  it('collects scalar, aliased wiki-link, and plain-text locations', async () => {
    await app.vault.create('Notes/one.md', '---\nlocation: "[[City|Local city]]"\n---\n');
    await app.vault.create('Notes/two.md', '---\nlocation: City\n---\n');
    await app.vault.create('Notes/three.md', '---\nlocation: Main Street 26, City\n---\n');
    await app.vault.create('Notes/ignored.txt', '---\nlocation: Ignored\n---\n');

    expect(LocationVaultSyncService.collectLocationUsage(app)).toEqual([
      { label: 'City', count: 2 },
      { label: 'Main Street 26, City', count: 1 },
    ]);
  });

  it('synchronizes discovered locations and persists only changed data', async () => {
    await app.vault.create('Notes/one.md', '---\nlocation: "[[Cafe]]"\n---\n');

    await service.syncNow();

    expect(adapter.data?.locations.some((location) => location.label === 'Cafe')).toBe(true);
    const cafeId = adapter.data?.locations.find((location) => location.label === 'Cafe')?.id;
    expect(adapter.data?.usage).toContainEqual({
      locationId: cafeId,
      count: 1,
      firstSeenAt: '2026-08-24T12:00:00.000Z',
      lastUsedAt: '2026-08-24T12:00:00.000Z',
    });

    await app.vault.modify(
      app.vault.getFileByPath('Notes/one.md')!,
      '---\nlocation: "[[Gym]]"\n---\n',
    );
    await service.syncNow();

    expect(adapter.data?.usage).toHaveLength(1);
    expect(store.getTopRecentLocations()[0]?.label).toBe('Gym');
  });
});
