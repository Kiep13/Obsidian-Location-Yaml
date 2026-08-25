import { Notice, Plugin, type TFile } from 'obsidian';
import { LocationStore } from './services/LocationStore';
import { LocationService } from './services/LocationService';
import { NewNoteCoordinator } from './services/NewNoteCoordinator';
import { LocationVaultSyncService } from './services/LocationVaultSyncService';
import { LocationSettingTab } from './ui/LocationSettingTab';
import { promptForLocation } from './ui/LocationAssignModal';
import { LocationStatisticsModal } from './ui/LocationStatisticsModal';
import type { LocationData, LocationDataAdapter } from './types';

export default class ObsidianLocationPlugin extends Plugin {
  private locationStore!: LocationStore;
  private locationService!: LocationService;
  private newNoteCoordinator!: NewNoteCoordinator;
  private locationVaultSyncService!: LocationVaultSyncService;
  private initialSyncStarted = false;

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
    this.locationVaultSyncService = new LocationVaultSyncService(this.app, this.locationStore);

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
    if (this.initialSyncStarted) {
      return;
    }

    const markdownFiles = this.app.vault.getMarkdownFiles();
    if (markdownFiles.some((file) => this.app.metadataCache.getFileCache(file) === null)) {
      return;
    }

    this.initialSyncStarted = true;
    await this.locationVaultSyncService.syncNow().catch(() => undefined);
    this.newNoteCoordinator.markReady();
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
    this.locationVaultSyncService?.cancel();
    super.onunload();
  }
}
