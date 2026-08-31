import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { App, TFile } from 'obsidian';
import { LocationStore } from './LocationStore';
import { NewNoteCoordinator } from './NewNoteCoordinator';
import { LocationService, type SyncBeforePrompt } from './LocationService';
import { LocationVaultSyncService } from './LocationVaultSyncService';
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

function useParsedEmptyLocationFrontMatter(app: App): void {
  vi.spyOn(app.fileManager, 'processFrontMatter').mockImplementation(async (file, callback) => {
    const content = await app.vault.read(file);
    const frontmatter = { location: null } as Record<string, string | null>;
    callback(frontmatter as unknown as Record<string, string>);
    const serializedValue = frontmatter.location === null
      ? 'null'
      : JSON.stringify(frontmatter.location);
    await app.vault.modify(
      file,
      content.replace(/^location:[^\r\n]*$/m, `location: ${serializedValue ?? ''}`),
    );
  });
}

function useLiteralLocationFrontMatter(app: App, label: string): void {
  vi.spyOn(app.fileManager, 'processFrontMatter').mockImplementation(async (file, callback) => {
    const content = await app.vault.read(file);
    const frontmatter = { location: label };
    callback(frontmatter);
    if (frontmatter.location !== label) {
      await app.vault.modify(
        file,
        content.replace(/^location:[^\r\n]*$/m, `location: ${JSON.stringify(frontmatter.location)}`),
      );
    }
  });
}

describe('LocationService', () => {
  let app: App;
  let adapter: MemoryAdapter;
  let store: LocationStore;
  let coordinator: NewNoteCoordinator;
  let syncBeforePrompt: Mock<SyncBeforePrompt>;
  let promptLocation: Mock<PromptLocation>;
  let service: LocationService;

  beforeEach(async () => {
    app = new App();
    adapter = new MemoryAdapter();
    store = new LocationStore(adapter, () => new Date('2026-06-21T10:00:00Z'));
    await store.load();
    coordinator = new NewNoteCoordinator(() => 0, 10 * 60 * 1000);
    syncBeforePrompt = vi.fn<SyncBeforePrompt>(async () => undefined);
    promptLocation = vi.fn<PromptLocation>(async (context: LocationPromptContext) => {
      void context;
      return { label: 'Cafe' };
    });
    service = new LocationService(app, store, coordinator, syncBeforePrompt, promptLocation);
  });

  it('synchronizes before opening the automatic new-note picker', async () => {
    coordinator.markReady();
    const events: string[] = [];
    syncBeforePrompt.mockImplementation(async () => {
      events.push('sync');
    });
    promptLocation.mockImplementation(async () => {
      events.push('prompt');
      return null;
    });
    const file = await app.vault.create('Notes/new-note.md', '# Hello');

    await service.handleVaultCreate(file);
    await service.handleFileOpen(file);

    expect(events).toEqual(['sync', 'prompt']);
    expect(syncBeforePrompt).toHaveBeenCalledOnce();
    expect(promptLocation).toHaveBeenCalledOnce();
  });

  it('synchronizes frontmatter changes before building a manual picker context', async () => {
    const sourceFile = await app.vault.create(
      'Notes/source.md',
      '---\nlocation: Cafe\n---\n',
    );
    const targetFile = await app.vault.create('Notes/target.md', '# Target');
    const syncService = new LocationVaultSyncService(app, store);
    syncBeforePrompt.mockImplementation(() => syncService.syncNow());
    await syncService.syncNow();

    await app.vault.modify(
      sourceFile,
      '---\nlocation: Gym\n---\n',
    );
    app.workspace.setActiveFile(targetFile);

    await service.assignActiveFileLocation();

    const promptContext = promptLocation.mock.calls[0]?.[0];
    expect(promptContext?.recentLocations.map((location) => location.label)).toEqual(['Gym']);
    expect(promptContext?.knownLocations.map((location) => location.label)).toContain('Gym');
    expect(promptContext?.recentLocations.map((location) => location.label)).not.toContain('Cafe');
    expect(syncBeforePrompt).toHaveBeenCalledOnce();
  });

  it('opens the picker with the last known context when pre-prompt sync fails', async () => {
    store.reconcileVaultUsage([{ label: 'Cafe', count: 1 }]);
    await store.save();
    syncBeforePrompt.mockRejectedValue(new Error('transient sync failure'));
    const file = await app.vault.create('Notes/target.md', '# Target');
    app.workspace.setActiveFile(file);

    await service.assignActiveFileLocation();

    expect(promptLocation).toHaveBeenCalledOnce();
    expect(promptLocation.mock.calls[0]?.[0].recentLocations.map((location) => location.label))
      .toEqual(['Cafe']);
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

  it('retries a committed location after its first persistence attempt fails', async () => {
    coordinator.markReady();
    const file = await app.vault.create('Notes/retry-location.md', '# Hello');
    await service.handleVaultCreate(file);

    const originalSave = MemoryAdapter.prototype.save.bind(adapter);
    const save = vi
      .spyOn(adapter, 'save')
      .mockRejectedValueOnce(new Error('first save failed'))
      .mockImplementation((data) => originalSave(data));

    await expect(service.handleFileOpen(file)).rejects.toThrow('first save failed');
    expect(store.hasUnsavedChanges()).toBe(true);
    expect(adapter.data).toBeNull();

    const syncService = new LocationVaultSyncService(app, store);
    await syncService.syncNow();

    expect(save).toHaveBeenCalledTimes(2);
    expect(store.hasUnsavedChanges()).toBe(false);
    expect(adapter.data?.locations.filter((location) => location.label === 'Cafe')).toHaveLength(1);
    const cafeId = adapter.data?.locations.find((location) => location.label === 'Cafe')?.id;
    expect(adapter.data?.usage).toContainEqual({
      locationId: cafeId,
      count: 1,
      firstSeenAt: '2026-06-21T10:00:00.000Z',
      lastUsedAt: '2026-06-21T10:00:00.000Z',
    });
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

  it('writes a CRLF note without location through processFrontMatter', async () => {
    coordinator.markReady();
    const file = await app.vault.create(
      'Notes/crlf-new-note.md',
      '---\r\ntitle: Hello\r\n---\r\n\r\n# Hello',
    );
    const originalProcessFrontMatter = app.fileManager.processFrontMatter.bind(app.fileManager);
    const processFrontMatter = vi.spyOn(app.fileManager, 'processFrontMatter').mockImplementation(
      async (frontmatterFile, callback) => {
        const content = await app.vault.read(frontmatterFile);
        await app.vault.modify(frontmatterFile, content.replace(/\r\n/g, '\n'));
        try {
          await originalProcessFrontMatter(frontmatterFile, callback);
        } finally {
          const processedContent = await app.vault.read(frontmatterFile);
          await app.vault.modify(frontmatterFile, processedContent.replace(/\n/g, '\r\n'));
        }
      },
    );

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'saved',
      locationId: 'location-cafe',
      locationLabel: 'Cafe',
    });
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    const writtenContent = await app.vault.read(file);
    expect(writtenContent).toContain('location: "[[Cafe]]"\r\n');
    expect(writtenContent).toContain('title: Hello\r\n');
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

  it.each([
    'location:',
    'location: # comment',
  ])('treats %s as an empty location value', async (locationLine) => {
    coordinator.markReady();
    const file = new TFile(`Notes/empty-location-${locationLine.length}.md`, 'md');
    await app.vault.modify(
      file,
      `---\n${locationLine}\n---\n\n# Hello`,
    );
    if (locationLine.includes('#')) {
      useParsedEmptyLocationFrontMatter(app);
    }

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'saved',
      locationId: 'location-cafe',
      locationLabel: 'Cafe',
    });
    expect(await app.vault.read(file)).toContain('location: "[[Cafe]]"');
  });

  it.each(['null', '~'])('treats a parsed YAML %s as empty despite an indented comment', async (nullValue) => {
    coordinator.markReady();
    const file = new TFile(`Notes/${nullValue}-location.md`, 'md');
    await app.vault.modify(file, `---\nlocation: ${nullValue}\n  # comment\n---\n\n# Hello`);
    useParsedEmptyLocationFrontMatter(app);

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'saved',
      locationId: 'location-cafe',
      locationLabel: 'Cafe',
    });
    expect(await app.vault.read(file)).toContain('location: "[[Cafe]]"');
  });

  it('keeps a value before an inline comment as an existing location', async () => {
    coordinator.markReady();
    const file = new TFile('Notes/inline-comment-location.md', 'md');
    await app.vault.modify(file, '---\nlocation: Office # comment\n---\n\n# Hello');

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      reason: 'already_has_location',
    });
    expect(promptLocation).not.toHaveBeenCalled();
  });

  it('does not inspect the body after the frontmatter delimiter', async () => {
    coordinator.markReady();
    const file = new TFile('Notes/body-location.md', 'md');
    await app.vault.modify(file, '---\ntitle: Hello\n---\n  location: Body text\n');

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'saved',
      locationId: 'location-cafe',
      locationLabel: 'Cafe',
    });
    expect(promptLocation).toHaveBeenCalledTimes(1);
  });

  it('recognizes only a top-level location key, not metadata.location', async () => {
    coordinator.markReady();
    promptLocation.mockResolvedValue(null);
    const nestedFile = new TFile('Notes/nested-location.md', 'md');
    await app.vault.modify(
      nestedFile,
      '---\nmetadata:\n  location: Nested\n---\n\n# Hello',
    );

    await service.handleVaultCreate(nestedFile);
    const nestedResult = await service.handleFileOpen(nestedFile);

    expect(nestedResult).toEqual({
      success: true,
      status: 'skipped',
      reason: 'cancelled',
    });
    expect(promptLocation).toHaveBeenCalledTimes(1);

    const topLevelFile = new TFile('Notes/top-level-location.md', 'md');
    await app.vault.modify(
      topLevelFile,
      '---\nmetadata:\n  location: Nested\nlocation: Top\n---\n\n# Hello',
    );

    await service.handleVaultCreate(topLevelFile);
    const topLevelResult = await service.handleFileOpen(topLevelFile);

    expect(topLevelResult).toEqual({
      success: true,
      status: 'skipped',
      reason: 'already_has_location',
    });
    expect(promptLocation).toHaveBeenCalledTimes(1);
  });

  it('writes an empty location before the delimiter without reading indented body text', async () => {
    coordinator.markReady();
    const file = new TFile('Notes/empty-location-with-body.md', 'md');
    await app.vault.modify(file, '---\nlocation:\n---\n  Body text\n');

    await service.handleVaultCreate(file);
    const result = await service.handleFileOpen(file);

    expect(result).toEqual({
      success: true,
      status: 'saved',
      locationId: 'location-cafe',
      locationLabel: 'Cafe',
    });
    expect(await app.vault.read(file)).toContain('location: "[[Cafe]]"');
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

  it.each(['null', '~', '# comment'])('preserves a quoted literal label %s as a no-op', async (label) => {
    const file = new TFile(`Notes/quoted-${label.length}.md`, 'md');
    await app.vault.modify(file, `---\nlocation: "${label}"\n---\n\n# Hello`);
    promptLocation.mockResolvedValue({ label });
    useLiteralLocationFrontMatter(app, label);
    app.workspace.setActiveFile(file);

    const result = await service.assignActiveFileLocation();

    expect(result).toEqual({
      success: true,
      status: 'skipped',
      reason: 'already_has_location',
    });
    expect(await app.vault.read(file)).toContain(`location: "${label}"`);
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
