import type { App, TFile } from 'obsidian';
import { LOCATION_FRONTMATTER_FIELD } from '../constants';
import type {
  LocationActionResult,
  LocationDefinition,
  LocationPromptContext,
  LocationPromptResult,
  LocationWriteResult,
} from '../types';
import { formatLocationFrontmatterValue } from '../utils/locationNormalization';
import type { LocationStore } from './LocationStore';
import type { NewNoteCoordinator } from './NewNoteCoordinator';

type PromptLocation = (context: LocationPromptContext) => Promise<LocationPromptResult | null>;

function hasLocationFrontmatter(content: string): boolean {
  return /^---\n[\s\S]*?^location:\s*/m.test(content);
}

export class LocationService {
  constructor(
    private readonly app: App,
    private readonly store: LocationStore,
    private readonly newNoteCoordinator: NewNoteCoordinator,
    private readonly promptLocation: PromptLocation,
  ) {}

  public async handleVaultCreate(file: TFile): Promise<void> {
    if (file.extension !== 'md' || !this.store.shouldShowPopupOnCreate()) {
      return;
    }

    this.newNoteCoordinator.markCreated(file.path);
  }

  public async handleFileOpen(file: TFile | null): Promise<LocationActionResult> {
    if (!file) {
      return { success: false, code: 'missing_active_file', message: 'No active file.' };
    }

    if (file.extension !== 'md') {
      return { success: true, status: 'skipped', reason: 'not_markdown' };
    }

    if (!this.newNoteCoordinator.shouldPrompt(file.path)) {
      return { success: true, status: 'skipped', reason: 'no_candidate' };
    }

    const content = await this.app.vault.read(file);
    if (hasLocationFrontmatter(content)) {
      this.newNoteCoordinator.markHandled(file.path);
      return { success: true, status: 'skipped', reason: 'already_has_location' };
    }

    return await this.promptAndWriteLocation(file, false);
  }

  public async assignActiveFileLocation(): Promise<LocationActionResult> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return {
        success: false,
        code: 'missing_active_file',
        message: 'No active note is open.',
      };
    }

    if (activeFile.extension !== 'md') {
      return { success: true, status: 'skipped', reason: 'not_markdown' };
    }

    return await this.promptAndWriteLocation(activeFile, true);
  }

  private async promptAndWriteLocation(
    file: TFile,
    overwriteExisting: boolean,
  ): Promise<LocationActionResult> {
    const promptContext = this.store.getPromptContext(file.path);
    const selectedLocation = await this.promptLocation(promptContext);

    if (!selectedLocation) {
      this.newNoteCoordinator.markSkipped(file.path);
      return { success: true, status: 'skipped', reason: 'cancelled' };
    }

    const resolvedLocation = this.store.resolveLocationInput(selectedLocation.label);
    if (!resolvedLocation) {
      this.newNoteCoordinator.markSkipped(file.path);
      return { success: true, status: 'skipped', reason: 'cancelled' };
    }

    const writeResult = await this.writeLocationFrontmatter(file, resolvedLocation, overwriteExisting);
    if (!writeResult.success) {
      this.newNoteCoordinator.markSkipped(file.path);
      return writeResult;
    }

    if (!writeResult.wrote) {
      this.newNoteCoordinator.markHandled(file.path);
      return { success: true, status: 'skipped', reason: 'already_has_location' };
    }

    const committedLocation = this.store.commitLocation(resolvedLocation);
    await this.store.save();
    this.newNoteCoordinator.markHandled(file.path);

    return {
      success: true,
      status: 'saved',
      locationId: committedLocation.id,
      locationLabel: committedLocation.label,
    };
  }

  private async writeLocationFrontmatter(
    file: TFile,
    location: LocationDefinition,
    overwriteExisting: boolean,
  ): Promise<LocationWriteResult> {
    try {
      const fileContent = await this.app.vault.read(file);
      if (!overwriteExisting && hasLocationFrontmatter(fileContent)) {
        return { success: true, wrote: false, reason: 'already_has_location' };
      }

      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (!overwriteExisting && frontmatter[LOCATION_FRONTMATTER_FIELD]) {
          return;
        }

        frontmatter[LOCATION_FRONTMATTER_FIELD] = formatLocationFrontmatterValue(location.label);
      });

      return { success: true, wrote: true };
    } catch (error) {
      return {
        success: false,
        code: 'write_failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
