import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice } from 'obsidian';
import ObsidianLocationPlugin from './main';
import { LocationVaultSyncService } from './services/LocationVaultSyncService';
import { LocationStatisticsModal } from './ui/LocationStatisticsModal';

describe('ObsidianLocationPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Notice.history.length = 0;
  });

  it('loads without throwing', async () => {
    const plugin = new ObsidianLocationPlugin();
    await expect(plugin.onload()).resolves.toBeUndefined();
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
});
