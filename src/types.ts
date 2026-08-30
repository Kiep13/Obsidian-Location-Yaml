export interface LocationDefinition {
  id: string;
  label: string;
}

export interface LocationUsage {
  locationId: string;
  count: number;
  firstSeenAt: string;
  /**
   * ISO timestamp of the latest explicit location commit. Vault reconciliation
   * updates the count snapshot but preserves this value because frontmatter
   * does not contain an event timestamp.
   */
  lastUsedAt: string;
}

export interface VaultLocationUsage {
  label: string;
  count: number;
}

export interface LocationUsageStatistic {
  locationId: string;
  label: string;
  count: number;
}

export interface LocationSettings {
  defaultLocationId: string;
  pinnedLocationIds: string[];
  showPopupOnCreate: boolean;
  autoApplyDefaultWhenOnlyOneChoice: boolean;
}

export interface LocationData {
  schemaVersion: 1;
  settings: LocationSettings;
  locations: LocationDefinition[];
  usage: LocationUsage[];
}

export interface LocationPromptContext {
  filePath: string;
  defaultLocation: LocationDefinition | null;
  pinnedLocations: LocationDefinition[];
  recentLocations: LocationDefinition[];
  knownLocations: LocationDefinition[];
}

export interface LocationPromptResult {
  label: string;
}

export type LocationWriteResult =
  | {
      success: true;
      wrote: boolean;
      reason?: 'already_has_location';
    }
  | {
      success: false;
      code: 'write_failed';
      message: string;
    };

export type LocationActionResult =
  | { success: true; status: 'saved'; locationId: string; locationLabel: string }
  | { success: true; status: 'skipped'; reason: 'not_markdown' | 'no_candidate' | 'cancelled' | 'already_has_location' | 'disabled' }
  | { success: false; code: 'missing_active_file' | 'write_failed'; message: string };

export interface LocationDataAdapter {
  /** Plugin storage is untrusted at runtime and must be validated by the store. */
  load: () => Promise<unknown>;
  save: (data: LocationData) => Promise<void>;
}
