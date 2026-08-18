import { Notice, Plugin, type TFile } from 'obsidian';
import { LocationStore } from './services/LocationStore';
import { LocationService } from './services/LocationService';
import { NewNoteCoordinator } from './services/NewNoteCoordinator';
import { LocationSettingTab } from './ui/LocationSettingTab';
import { promptForLocation } from './ui/LocationAssignModal';
import type { LocationData, LocationDataAdapter } from './types';

export default class ObsidianLocationPlugin extends Plugin {
  private locationStore!: LocationStore;
  private locationService!: LocationService;
  private newNoteCoordinator!: NewNoteCoordinator;

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

    this.app.workspace.onLayoutReady(() => {
      this.newNoteCoordinator.markReady();
    });

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

    this.addSettingTab(new LocationSettingTab(this.app, this.locationStore));
  }

  private async handleVaultCreate(file: TFile): Promise<void> {
    await this.locationService.handleVaultCreate(file);
  }

  private async assignActiveLocation(): Promise<void> {
    const result = await this.locationService.assignActiveFileLocation();
    if (!result.success) {
      new Notice(result.message, 6000);
    }
  }
}
