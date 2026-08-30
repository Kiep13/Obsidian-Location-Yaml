import { LOCATION_FRONTMATTER_FIELD } from '../constants';
import type { App } from 'obsidian';
import type { VaultLocationUsage } from '../types';
import { normalizeLocationKey, normalizeLocationLabel } from '../utils/locationNormalization';
import type { LocationStore } from './LocationStore';

const SYNC_DEBOUNCE_MS = 250;
const SYNC_RETRY_BASE_MS = 500;
const MAX_BACKGROUND_RETRIES = 3;

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
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private syncQueue: Promise<void> = Promise.resolve();
  private timerGeneration = 0;
  private retryAttempt = 0;
  private persistencePending = false;
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly store: LocationStore,
    private readonly onError: SyncErrorHandler = () => undefined,
  ) {}

  public syncNow(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    this.invalidateScheduledTimers();

    return this.enqueueSync();
  }

  private enqueueSync(): Promise<void> {
    const syncTask = this.syncQueue.then(async () => {
      const entries = collectLocationUsage(this.app);
      if (this.store.reconcileVaultUsage(entries)) {
        this.persistencePending = true;
      }

      if (this.persistencePending) {
        await this.store.save();
        this.persistencePending = false;
      }
    });

    this.syncQueue = syncTask.catch(() => undefined);
    return syncTask;
  }

  public schedule(): void {
    if (this.disposed) {
      return;
    }

    this.invalidateScheduledTimers();
    const timerGeneration = this.timerGeneration;

    this.pendingTimer = setTimeout(() => {
      if (timerGeneration !== this.timerGeneration) {
        return;
      }

      this.pendingTimer = null;
      void this.runScheduledSync(timerGeneration);
    }, SYNC_DEBOUNCE_MS);
  }

  public cancel(): void {
    this.disposed = true;
    this.invalidateScheduledTimers();
  }

  private invalidateScheduledTimers(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }

    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    this.timerGeneration += 1;
    this.retryAttempt = 0;
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

  private runScheduledSync(timerGeneration: number): Promise<void> {
    return this.enqueueSync().then(
      () => {
        if (!this.disposed && timerGeneration === this.timerGeneration) {
          this.retryAttempt = 0;
        }
      },
      (error: unknown) => {
        if (this.disposed || timerGeneration !== this.timerGeneration) {
          return;
        }

        this.reportError(error);
        this.scheduleRetry();
      },
    );
  }

  private scheduleRetry(): void {
    if (
      this.disposed ||
      this.pendingTimer !== null ||
      this.retryAttempt >= MAX_BACKGROUND_RETRIES ||
      this.retryTimer !== null
    ) {
      return;
    }

    this.retryAttempt += 1;
    const retryDelay = SYNC_RETRY_BASE_MS * 2 ** (this.retryAttempt - 1);
    const timerGeneration = this.timerGeneration;
    this.retryTimer = setTimeout(() => {
      if (timerGeneration !== this.timerGeneration) {
        return;
      }

      this.retryTimer = null;
      void this.runScheduledSync(timerGeneration);
    }, retryDelay);
  }
}
