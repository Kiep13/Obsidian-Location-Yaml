import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { LocationStore } from './LocationStore';
import { NewNoteCoordinator } from './NewNoteCoordinator';
import { LocationService } from './LocationService';
import type { LocationData, LocationDataAdapter, LocationPromptContext, LocationPromptResult } from '../types';

type PromptLocation = (context: LocationPromptContext) => Promise<LocationPromptResult | null>;

class MemoryAdapter implements LocationDataAdapter {
  public data: LocationData | null = null;

  public async load(): Promise<LocationData | null> {
    return this.data;
  }

  public async save(data: LocationData): Promise<void> {
    this.data = JSON.parse(JSON.stringify(data)) as LocationData;
  }
}

describe('LocationService', () => {
  let app: App;
  let adapter: MemoryAdapter;
  let store: LocationStore;
  let coordinator: NewNoteCoordinator;
  let promptLocation: PromptLocation;
  let service: LocationService;

  beforeEach(async () => {
    app = new App();
    adapter = new MemoryAdapter();
    store = new LocationStore(adapter, () => new Date('2026-06-21T10:00:00Z'));
    await store.load();
    coordinator = new NewNoteCoordinator(() => 0, 10 * 60 * 1000);
    promptLocation = vi.fn<PromptLocation>(async (context: LocationPromptContext) => {
      void context;
      return { label: 'Cafe' };
    });
    service = new LocationService(app, store, coordinator, promptLocation);
  });

  it('writes frontmatter when a new markdown file opens after create', async () => {
    coordinator.markReady();
    const file = await app.vault.create('Notes/new-note.md', '# Hello');

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'saved',
      locationId: 'location-cafe',
      locationLabel: 'Cafe',
    });
    expect(promptLocation).toHaveBeenCalledTimes(1);

    const writtenContent = await app.vault.read(file);
    expect(writtenContent).toContain('location: "[[Cafe]]"');
    expect(writtenContent).not.toContain('location-id:');

    const recentLocations = store.getTopRecentLocations(1);
    expect(recentLocations[0]?.label).toBe('Cafe');
  });

  it('auto-applies the only known location without opening the picker', async () => {
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
    coordinator.markReady();
    const file = await app.vault.create('Notes/only-choice.md', '# Hello');

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'saved',
      locationId: 'location-cafe',
      locationLabel: 'Cafe',
    });
    expect(promptLocation).not.toHaveBeenCalled();
    expect(await app.vault.read(file)).toContain('location: "[[Cafe]]"');
  });

  it('recognizes CRLF and supported location field formatting', async () => {
    coordinator.markReady();
    const file = new TFile('Notes/crlf-location.md', 'md');
    await app.vault.modify(
      file,
      "---\r\nlocation : '[[Office]]'\r\n---\r\n\r\n# Hello",
    );

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      reason: 'already_has_location',
    });
    expect(promptLocation).not.toHaveBeenCalled();
  });

  it('reports a no-op when assigning the same existing location', async () => {
    const file = new TFile('Notes/same-location.md', 'md');
    await app.vault.modify(file, '---\nlocation: [[Cafe]]\n---\n\n# Hello');
    app.workspace.setActiveFile(file);

    const result = await service.assignActiveFileLocation();

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      reason: 'already_has_location',
    });
    expect(store.getTopRecentLocations()).toEqual([]);
  });

  it('skips files that already have location frontmatter', async () => {
    coordinator.markReady();
    const file = new TFile('Notes/with-location.md', 'md');
    await app.vault.modify(
      file,
      '---\nlocation: "[[Office]]"\n---\n\n# Hello',
    );

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      reason: 'already_has_location',
    });
    expect(promptLocation).not.toHaveBeenCalled();
  });

  it('ignores create candidates before startup is ready', async () => {
    const file = await app.vault.create('Notes/reloaded-note.md', '# Hello');

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      reason: 'no_candidate',
    });
    expect(promptLocation).not.toHaveBeenCalled();
  });

  it('returns a structured error when there is no active file', async () => {
    const result = await service.assignActiveFileLocation();

    expect(result).toEqual({
      success: false,
      code: 'missing_active_file',
      message: 'No active note is open.',
    });
  });
});
