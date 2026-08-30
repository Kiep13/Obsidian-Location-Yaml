import { Notice, Plugin, type TFile } from 'obsidian';
import { LocationStore } from './services/LocationStore';
import { LocationService } from './services/LocationService';
import { NewNoteCoordinator } from './services/NewNoteCoordinator';
import { LocationVaultSyncService } from './services/LocationVaultSyncService';
import { LocationSettingTab } from './ui/LocationSettingTab';
import { promptForLocation } from './ui/LocationAssignModal';
import { LocationStatisticsModal } from './ui/LocationStatisticsModal';
import type { LocationData, LocationDataAdapter } from './types';

const INITIAL_SYNC_RETRY_BASE_MS = 1000;
const INITIAL_SYNC_RETRY_MAX_MS = 8000;

export default class ObsidianLocationPlugin extends Plugin {
  private locationStore!: LocationStore;
  private locationService!: LocationService;
  private newNoteCoordinator!: NewNoteCoordinator;
  private locationVaultSyncService!: LocationVaultSyncService;
  private initialSyncStarted = false;
  private initialSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private initialSyncRetryAttempt = 0;

  public async onload(): Promise<void> {
    const dataAdapter: LocationDataAdapter = {
      load: async () => (await this.loadData()) as LocationData | null,
      save: async (data) => {
        await this.saveData(data);
      },
    };

    this.locationStore = new LocationStore(dataAdapter);
    await this.locationStore.load();
    this.newNoteCoordinator = new NewNoteCoordinator();
    this.locationService = new LocationService(
      this.app,
      this.locationStore,
      this.newNoteCoordinator,
      async (context) => await promptForLocation(this.app, context),
    );
    this.locationVaultSyncService = new LocationVaultSyncService(
      this.app,
      this.locationStore,
      () => {
        new Notice('Unable to synchronize locations from the vault.', 6000);
      },
    );

    this.registerEvent(
      this.app.metadataCache.on('resolved', () => {
        void this.initializeAfterMetadataResolved();
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      void this.initializeAfterMetadataResolved();
    });

    this.registerEvent(
      this.app.metadataCache.on('changed', () => {
        this.locationVaultSyncService.schedule();
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', () => {
        this.locationVaultSyncService.schedule();
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', () => {
        this.locationVaultSyncService.schedule();
      }),
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        void this.handleVaultCreate(file);
      }),
    );

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        void this.locationService.handleFileOpen(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        void oldPath;
        this.newNoteCoordinator.handleRename(oldPath, file.path);
      }),
    );

    this.addCommand({
      id: 'assign-location-to-active-note',
      name: 'Assign location to active note',
      callback: () => {
        void this.assignActiveLocation();
      },
    });

    this.addCommand({
      id: 'open-statistic-modal',
      name: 'Open Statistic Modal',
      callback: () => this.openStatisticsModal(),
    });

    this.addSettingTab(new LocationSettingTab(this.app, this.locationStore));
  }

  private async handleVaultCreate(file: TFile): Promise<void> {
    await this.locationService.handleVaultCreate(file);
  }

  private async initializeAfterMetadataResolved(): Promise<void> {
    if (this.initialSyncStarted || this.initialSyncRetryTimer !== null) {
      return;
    }

    const markdownFiles = this.app.vault.getMarkdownFiles();
    if (markdownFiles.some((file) => this.app.metadataCache.getFileCache(file) === null)) {
      return;
    }

    this.initialSyncStarted = true;
    try {
      await this.locationVaultSyncService.syncNow();
      this.newNoteCoordinator.markReady();
    } catch {
      this.initialSyncStarted = false;
      new Notice('Unable to synchronize locations from the vault.', 6000);
      this.scheduleInitialSyncRetry();
    }
  }

  private scheduleInitialSyncRetry(): void {
    if (this.initialSyncRetryTimer !== null) {
      return;
    }

    this.initialSyncRetryAttempt += 1;
    const retryDelay = Math.min(
      INITIAL_SYNC_RETRY_BASE_MS * 2 ** (this.initialSyncRetryAttempt - 1),
      INITIAL_SYNC_RETRY_MAX_MS,
    );
    this.initialSyncRetryTimer = setTimeout(() => {
      this.initialSyncRetryTimer = null;
      void this.initializeAfterMetadataResolved();
    }, retryDelay);
  }

  private async assignActiveLocation(): Promise<void> {
    const result = await this.locationService.assignActiveFileLocation();
    if (!result.success) {
      new Notice(result.message, 6000);
    }
  }

  private async openStatisticsModal(): Promise<void> {
    try {
      await this.locationVaultSyncService.syncNow();
    } catch {
      new Notice('Unable to synchronize location statistics.', 6000);
      return;
    }

    new LocationStatisticsModal(this.app, this.locationStore.getUsageStatistics()).open();
  }

  public override onunload(): void {
    if (this.initialSyncRetryTimer !== null) {
      clearTimeout(this.initialSyncRetryTimer);
      this.initialSyncRetryTimer = null;
    }
    this.locationVaultSyncService?.cancel();
    super.onunload();
  }
}
