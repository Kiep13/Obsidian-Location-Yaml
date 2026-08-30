import { LOCATION_FRONTMATTER_FIELD } from '../constants';
import type { App } from 'obsidian';
import type { VaultLocationUsage } from '../types';
import { normalizeLocationKey, normalizeLocationLabel } from '../utils/locationNormalization';
import type { LocationStore } from './LocationStore';

const SYNC_DEBOUNCE_MS = 250;

export type SyncErrorHandler = (error: unknown) => void;

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
    const locationKeysInFile = new Set<string>();

    for (const value of getRawLocationValues(rawValue)) {
      if (typeof value !== 'string') {
        continue;
      }

      const label = normalizeLocationLabel(value);
      const key = normalizeLocationKey(label);
      if (!key || locationKeysInFile.has(key)) {
        continue;
      }
      locationKeysInFile.add(key);

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
  private timerGeneration = 0;

  constructor(
    private readonly app: App,
    private readonly store: LocationStore,
    private readonly onError: SyncErrorHandler = () => undefined,
  ) {}

  public syncNow(): Promise<void> {
    this.cancel();

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
    this.cancel();
    const timerGeneration = ++this.timerGeneration;

    this.pendingTimer = setTimeout(() => {
      if (timerGeneration !== this.timerGeneration) {
        return;
      }

      this.pendingTimer = null;
      void this.syncNow().catch((error: unknown) => {
        this.reportError(error);
      });
    }, SYNC_DEBOUNCE_MS);
  }

  public cancel(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }

    this.timerGeneration += 1;
  }

  public static collectLocationUsage(app: App): VaultLocationUsage[] {
    return collectLocationUsage(app);
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // An error reporter must not break the sync queue or create an unhandled rejection.
    }
  }
}
