import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice } from 'obsidian';
import ObsidianLocationPlugin from './main';
import { NewNoteCoordinator } from './services/NewNoteCoordinator';
import { LocationStore } from './services/LocationStore';
import { LocationVaultSyncService } from './services/LocationVaultSyncService';
import { LocationStatisticsModal } from './ui/LocationStatisticsModal';

describe('ObsidianLocationPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Notice.history.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads without throwing', async () => {
    const plugin = new ObsidianLocationPlugin();
    await expect(plugin.onload()).resolves.toBeUndefined();
  });

  it('passes the plugin instance to the settings tab', async () => {
    const plugin = new ObsidianLocationPlugin();

    await plugin.onload();

    expect(plugin.settingTabs).toHaveLength(1);
    expect(plugin.settingTabs[0]?.plugin).toBe(plugin);
  });

  it('synchronizes before opening the statistics modal', async () => {
    const syncNow = vi.spyOn(LocationVaultSyncService.prototype, 'syncNow').mockResolvedValue();
    const open = vi.spyOn(LocationStatisticsModal.prototype, 'open').mockImplementation(() => undefined);
    const plugin = new ObsidianLocationPlugin();
    await plugin.onload();

    await plugin.executeCommand('open-statistic-modal');

    expect(syncNow).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it('does not open the statistics modal when synchronization fails', async () => {
    vi.spyOn(LocationVaultSyncService.prototype, 'syncNow').mockRejectedValue(new Error('sync failed'));
    const open = vi.spyOn(LocationStatisticsModal.prototype, 'open').mockImplementation(() => undefined);
    const plugin = new ObsidianLocationPlugin();
    await plugin.onload();

    await plugin.executeCommand('open-statistic-modal');

    expect(open).not.toHaveBeenCalled();
    expect(Notice.history.at(-1)?.message).toBe('Unable to synchronize location statistics.');
  });

  it('debounces metadata events and reports background sync failures', async () => {
    vi.useFakeTimers();
    vi.spyOn(LocationStore.prototype, 'save').mockRejectedValue(new Error('background sync failed'));
    const plugin = new ObsidianLocationPlugin();
    await plugin.onload();
    await plugin.app.vault.create('Notes/one.md', '---\nlocation: Cafe\n---\n');

    plugin.app.metadataCache.emit('changed');
    plugin.app.metadataCache.emit('changed');
    await vi.advanceTimersByTimeAsync(249);
    expect(Notice.history).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(Notice.history.at(-1)?.message).toBe('Unable to synchronize locations from the vault.');
    plugin.onunload();
  });

  it('reports initial sync failures and allows a later initial retry', async () => {
    vi.useFakeTimers();
    const syncNow = vi
      .spyOn(LocationVaultSyncService.prototype, 'syncNow')
      .mockRejectedValueOnce(new Error('initial sync failed'))
      .mockResolvedValueOnce();
    const markReady = vi.spyOn(NewNoteCoordinator.prototype, 'markReady');
    const plugin = new ObsidianLocationPlugin();
    await plugin.onload();

    plugin.app.metadataCache.emit('resolved');
    await Promise.resolve();
    await Promise.resolve();

    expect(syncNow).toHaveBeenCalledOnce();
    expect(Notice.history.at(-1)?.message).toBe('Unable to synchronize locations from the vault.');

    await vi.advanceTimersByTimeAsync(999);
    expect(syncNow).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect(syncNow).toHaveBeenCalledTimes(2);
    expect(markReady).toHaveBeenCalledOnce();
    plugin.onunload();
  });

  it('retries initial sync when metadata cache is still unresolved', async () => {
    vi.useFakeTimers();
    const syncNow = vi.spyOn(LocationVaultSyncService.prototype, 'syncNow').mockResolvedValue();
    const markReady = vi.spyOn(NewNoteCoordinator.prototype, 'markReady');
    const plugin = new ObsidianLocationPlugin();
    await plugin.onload();
    await plugin.app.vault.create('Notes/one.md', '---\nlocation: Cafe\n---\n');
    vi.spyOn(plugin.app.metadataCache, 'getFileCache')
      .mockReturnValueOnce(null)
      .mockReturnValue({ frontmatter: {} });

    plugin.app.metadataCache.emit('resolved');

    expect(syncNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(syncNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(syncNow).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledOnce();
    plugin.onunload();
  });

  it('suppresses a post-unload initial failure from a deferred save', async () => {
    vi.useFakeTimers();
    let rejectSave: (reason?: unknown) => void = () => undefined;
    const deferredSave = new Promise<void>((resolveSave, rejectSavePromise) => {
      void resolveSave;
      rejectSave = rejectSavePromise;
    });
    const save = vi.spyOn(LocationStore.prototype, 'save').mockReturnValue(deferredSave);
    const plugin = new ObsidianLocationPlugin();
    await plugin.onload();
    await plugin.app.vault.create('Notes/one.md', '---\nlocation: Cafe\n---\n');

    plugin.app.metadataCache.emit('resolved');
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();

    plugin.onunload();
    rejectSave(new Error('deferred save failed'));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10000);

    expect(Notice.history).toHaveLength(0);
    expect(save).toHaveBeenCalledOnce();
  });
});
