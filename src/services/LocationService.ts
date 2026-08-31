import type { App, TFile } from 'obsidian';
import { LOCATION_FRONTMATTER_FIELD } from '../constants';
import type {
  LocationActionResult,
  LocationDefinition,
  LocationPromptContext,
  LocationPromptResult,
  LocationWriteResult,
} from '../types';
import { formatLocationFrontmatterValue, normalizeLocationKey } from '../utils/locationNormalization';
import type { LocationStore } from './LocationStore';
import type { NewNoteCoordinator } from './NewNoteCoordinator';

type PromptLocation = (context: LocationPromptContext) => Promise<LocationPromptResult | null>;
export type SyncBeforePrompt = () => Promise<void>;

interface ParsedYamlLocationValue {
  quoted: boolean;
  value: string;
}

function parseYamlLocationValue(rawValue: string): ParsedYamlLocationValue {
  const trimmedValue = rawValue.trim();
  if (!trimmedValue || trimmedValue.startsWith('#')) {
    return { quoted: false, value: '' };
  }

  const quote = trimmedValue[0];
  if (quote === '"' || quote === "'") {
    const closingQuoteIndex = trimmedValue.lastIndexOf(quote);
    return {
      quoted: true,
      value: trimmedValue.slice(1, closingQuoteIndex > 0 ? closingQuoteIndex : undefined),
    };
  }

  return {
    quoted: false,
    value: trimmedValue.replace(/\s+#.*$/, '').trim(),
  };
}

function isYamlNullValue(value: string): boolean {
  return value === '~' || value.toLowerCase() === 'null';
}

function hasYamlLocationValue(rawValue: string): boolean {
  const parsedValue = parseYamlLocationValue(rawValue);
  return parsedValue.value !== '' && (parsedValue.quoted || !isYamlNullValue(parsedValue.value));
}

function hasLocationFrontmatter(content: string): boolean {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.replace(/^\uFEFF/, '') !== '---') {
    return false;
  }

  const closingDelimiterIndex = lines.slice(1).findIndex((line) => /^---\s*$/.test(line));
  if (closingDelimiterIndex < 0) {
    return false;
  }

  const frontmatterLines = lines.slice(1, closingDelimiterIndex + 1);
  for (const [lineIndex, line] of frontmatterLines.entries()) {
    const match = /^(?:location|["']location["'])[ \t]*:(.*)$/.exec(line);
    if (match) {
      if (hasYamlLocationValue(match[1])) {
        return true;
      }

      if (match[1].trim() !== '') {
        return false;
      }

      for (const continuationLine of frontmatterLines.slice(lineIndex + 1)) {
        const trimmedContinuationLine = continuationLine.trim();
        if (!trimmedContinuationLine || trimmedContinuationLine.startsWith('#')) {
          continue;
        }

        return /^[ \t]+\S/.test(continuationLine);
      }

      return false;
    }
  }

  return false;
}

export class LocationService {
  constructor(
    private readonly app: App,
    private readonly store: LocationStore,
    private readonly newNoteCoordinator: NewNoteCoordinator,
    private readonly syncBeforePrompt: SyncBeforePrompt,
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

    const promptContext = await this.getPromptContext(file.path);
    if (this.store.shouldAutoApplyDefault() && promptContext.knownLocations.length === 1) {
      return await this.applyLocation(file, promptContext.knownLocations[0], false);
    }

    return await this.promptAndWriteLocation(file, false, promptContext);
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
    promptContext?: LocationPromptContext,
  ): Promise<LocationActionResult> {
    const context = promptContext ?? await this.getPromptContext(file.path);
    const selectedLocation = await this.promptLocation(context);

    if (!selectedLocation) {
      this.newNoteCoordinator.markSkipped(file.path);
      return { success: true, status: 'skipped', reason: 'cancelled' };
    }

    const resolvedLocation = this.store.resolveLocationInput(selectedLocation.label);
    if (!resolvedLocation) {
      this.newNoteCoordinator.markSkipped(file.path);
      return { success: true, status: 'skipped', reason: 'cancelled' };
    }

    return await this.applyLocation(file, resolvedLocation, overwriteExisting);
  }

  private async getPromptContext(filePath: string): Promise<LocationPromptContext> {
    try {
      await this.syncBeforePrompt();
    } catch {
      // The store retains its last known in-memory state when a fresh sync fails.
    }

    return this.store.getPromptContext(filePath);
  }

  private async applyLocation(
    file: TFile,
    location: LocationDefinition,
    overwriteExisting: boolean,
  ): Promise<LocationActionResult> {
    const writeResult = await this.writeLocationFrontmatter(file, location, overwriteExisting);
    if (!writeResult.success) {
      this.newNoteCoordinator.markSkipped(file.path);
      return writeResult;
    }

    if (!writeResult.wrote) {
      this.newNoteCoordinator.markHandled(file.path);
      return { success: true, status: 'skipped', reason: 'already_has_location' };
    }

    const committedLocation = this.store.commitLocation(location);
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

      let changed = false;
      const nextValue = formatLocationFrontmatterValue(location.label);
      const nextLocationKey = normalizeLocationKey(location.label);
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        const existingValue = frontmatter[LOCATION_FRONTMATTER_FIELD];
        const existingLocationKey = typeof existingValue === 'string'
          ? normalizeLocationKey(existingValue)
          : '';
        const hasExistingValue =
          existingLocationKey !== '' ||
          (existingValue !== undefined && existingValue !== null && typeof existingValue !== 'string');
        const isSameLocation = existingLocationKey !== '' && existingLocationKey === nextLocationKey;

        if (hasExistingValue && (!overwriteExisting || isSameLocation)) {
          return;
        }

        frontmatter[LOCATION_FRONTMATTER_FIELD] = nextValue;
        changed = true;
      });

      return changed
        ? { success: true, wrote: true }
        : { success: true, wrote: false, reason: 'already_has_location' };
    } catch (error) {
      return {
        success: false,
        code: 'write_failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
