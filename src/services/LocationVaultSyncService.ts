import { LOCATION_FRONTMATTER_FIELD } from '../constants';
import type { App } from 'obsidian';
import type { VaultLocationUsage } from '../types';
import { normalizeLocationLabel } from '../utils/locationNormalization';
import type { LocationStore } from './LocationStore';

const SYNC_DEBOUNCE_MS = 250;

function getRawLocationValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function collectLocationUsage(app: App): VaultLocationUsage[] {
  const usageByKey = new Map<string, VaultLocationUsage>();
  const markdownFiles = [...app.vault.getMarkdownFiles()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  for (const file of markdownFiles) {
    const rawValue = app.metadataCache.getFileCache(file)?.frontmatter?.[LOCATION_FRONTMATTER_FIELD];
    for (const value of getRawLocationValues(rawValue)) {
      if (typeof value !== 'string') {
        continue;
      }

      const label = normalizeLocationLabel(value);
      const key = label.toLocaleLowerCase();
      if (!key) {
        continue;
      }

      const existingEntry = usageByKey.get(key);
      if (existingEntry) {
        existingEntry.count += 1;
      } else {
        usageByKey.set(key, { label, count: 1 });
      }
    }
  }

  return [...usageByKey.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export class LocationVaultSyncService {
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private syncQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly app: App,
    private readonly store: LocationStore,
  ) {}

  public syncNow(): Promise<void> {
    const syncTask = this.syncQueue.then(async () => {
      const entries = collectLocationUsage(this.app);
      if (this.store.reconcileVaultUsage(entries)) {
        await this.store.save();
      }
    });

    this.syncQueue = syncTask.catch(() => undefined);
    return syncTask;
  }

  public schedule(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
    }

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.syncNow().catch(() => undefined);
    }, SYNC_DEBOUNCE_MS);
  }

  public cancel(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  public static collectLocationUsage(app: App): VaultLocationUsage[] {
    return collectLocationUsage(app);
  }
}
