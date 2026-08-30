import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

class BlockingAdapter implements LocationDataAdapter {
  public data: LocationData | null = null;
  public saveCalls = 0;
  private releasePendingSave: (() => void) | null = null;

  public async load(): Promise<LocationData | null> {
    return this.data;
  }

  public save(data: LocationData): Promise<void> {
    this.data = JSON.parse(JSON.stringify(data)) as LocationData;
    this.saveCalls += 1;
    return new Promise<void>((resolveSave) => {
      this.releasePendingSave = resolveSave;
    });
  }

  public releaseSave(): void {
    this.releasePendingSave?.();
    this.releasePendingSave = null;
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('counts each note once for each unique location in a multi-value field', () => {
    const valuesByPath: Record<string, unknown> = {
      'Notes/one.md': ['[[City|Local city]]', 'City', 'Beach'],
      'Notes/two.md': ['[[City]]', 'Beach'],
    };
    vi.spyOn(app.metadataCache, 'getFileCache').mockImplementation((file) => ({
      frontmatter: {
        location: valuesByPath[file.path],
      } as unknown as Record<string, string>,
    }));

    expect(LocationVaultSyncService.collectLocationUsage(app)).toEqual([
      { label: 'Beach', count: 2 },
      { label: 'City', count: 2 },
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

  it('coalesces scheduled events using the 250ms debounce', async () => {
    vi.useFakeTimers();
    const syncNow = vi.spyOn(service, 'syncNow').mockResolvedValue();

    service.schedule();
    service.schedule();

    await vi.advanceTimersByTimeAsync(249);
    expect(syncNow).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(syncNow).toHaveBeenCalledOnce();
  });

  it('cancels a pending scheduled scan before a manual sync', async () => {
    vi.useFakeTimers();
    const markdownFileScan = vi.spyOn(app.vault, 'getMarkdownFiles');
    await app.vault.create('Notes/one.md', '---\nlocation: Cafe\n---\n');

    service.schedule();
    await service.syncNow();
    await vi.advanceTimersByTimeAsync(250);

    expect(markdownFileScan).toHaveBeenCalledOnce();
  });

  it('reports a background sync failure to its error handler', async () => {
    const onError = vi.fn();
    vi.spyOn(adapter, 'save').mockRejectedValue(new Error('save failed'));
    const failingService = new LocationVaultSyncService(app, store, onError);
    await app.vault.create('Notes/one.md', '---\nlocation: Cafe\n---\n');

    vi.useFakeTimers();
    failingService.schedule();
    await vi.advanceTimersByTimeAsync(250);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('serializes sync runs and waits for the previous save', async () => {
    const blockingAdapter = new BlockingAdapter();
    const blockingStore = new LocationStore(
      blockingAdapter,
      () => new Date('2026-08-24T12:00:00.000Z'),
    );
    await blockingStore.load();
    const serializedService = new LocationVaultSyncService(app, blockingStore);
    await app.vault.create('Notes/one.md', '---\nlocation: Cafe\n---\n');
    const markdownFileScan = vi.spyOn(app.vault, 'getMarkdownFiles');

    const firstSync = serializedService.syncNow();
    await Promise.resolve();
    const secondSync = serializedService.syncNow();
    await Promise.resolve();

    expect(blockingAdapter.saveCalls).toBe(1);
    expect(markdownFileScan).toHaveBeenCalledOnce();

    blockingAdapter.releaseSave();
    await firstSync;
    await secondSync;

    expect(markdownFileScan).toHaveBeenCalledTimes(2);
  });
});
