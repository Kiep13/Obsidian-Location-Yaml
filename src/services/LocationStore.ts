import { DEFAULT_DATA, DEFAULT_RECENT_LIMIT } from '../constants';
import type {
  LocationData,
  LocationDataAdapter,
  LocationDefinition,
  LocationPromptContext,
  LocationSettings,
  LocationUsage,
  LocationUsageStatistic,
  VaultLocationUsage,
} from '../types';
import {
  createLocationId,
  dedupeLocationsByKey,
  normalizeLocationKey,
  normalizeLocationLabel,
} from '../utils/locationNormalization';

function cloneData(data: LocationData): LocationData {
  return {
    schemaVersion: 1,
    settings: {
      defaultLocationId: data.settings.defaultLocationId,
      pinnedLocationIds: [...data.settings.pinnedLocationIds],
      showPopupOnCreate: data.settings.showPopupOnCreate,
      autoApplyDefaultWhenOnlyOneChoice: data.settings.autoApplyDefaultWhenOnlyOneChoice,
    },
    locations: data.locations.map((location) => ({ ...location })),
    usage: data.usage.map((usageEntry) => ({ ...usageEntry })),
  };
}

function mergeLoadedData(loadedData: LocationData | null): LocationData {
  if (!loadedData) {
    return cloneData(DEFAULT_DATA);
  }

  const mergedLocations = dedupeLocationsByKey(loadedData.locations ?? []);
  const existingLocationIds = new Set(mergedLocations.map((location) => location.id));

  const mergedSettings: LocationSettings = {
    defaultLocationId:
      mergedLocations.find((location) => location.id === loadedData.settings?.defaultLocationId)?.id ??
      mergedLocations[0]?.id ??
      '',
    pinnedLocationIds: (loadedData.settings?.pinnedLocationIds ?? []).filter((locationId) => existingLocationIds.has(locationId)).slice(0, 1),
    showPopupOnCreate: loadedData.settings?.showPopupOnCreate ?? DEFAULT_DATA.settings.showPopupOnCreate,
    autoApplyDefaultWhenOnlyOneChoice:
      loadedData.settings?.autoApplyDefaultWhenOnlyOneChoice ??
      DEFAULT_DATA.settings.autoApplyDefaultWhenOnlyOneChoice,
  };

  const mergedUsage = (loadedData.usage ?? []).filter((usageEntry) => existingLocationIds.has(usageEntry.locationId));

  return {
    schemaVersion: 1,
    settings: mergedSettings,
    locations: mergedLocations,
    usage: mergedUsage,
  };
}

function sortUsageEntries(usageEntries: LocationUsage[]): LocationUsage[] {
  return [...usageEntries].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    if (right.lastUsedAt !== left.lastUsedAt) {
      return right.lastUsedAt.localeCompare(left.lastUsedAt);
    }

    return left.locationId.localeCompare(right.locationId);
  });
}

export class LocationStore {
  private data: LocationData = cloneData(DEFAULT_DATA);

  constructor(
    private readonly dataAdapter: LocationDataAdapter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async load(): Promise<void> {
    const loadedData = await this.dataAdapter.load();
    this.data = mergeLoadedData(loadedData);
  }

  public async save(): Promise<void> {
    await this.dataAdapter.save(this.data);
  }

  public reconcileVaultUsage(entries: VaultLocationUsage[]): boolean {
    const nowIso = this.clock().toISOString();
    const currentUsageByKey = new Map<string, VaultLocationUsage>();

    for (const entry of entries) {
      const label = normalizeLocationLabel(entry.label);
      const key = label.toLocaleLowerCase();
      if (!key || currentUsageByKey.has(key)) {
        continue;
      }

      currentUsageByKey.set(key, {
        label,
        count: Math.max(0, Math.trunc(entry.count)),
      });
    }

    const locationsByKey = new Map(
      this.data.locations.map((location) => [normalizeLocationKey(location.label), location]),
    );
    let locationsChanged = false;

    for (const entry of currentUsageByKey.values()) {
      if (locationsByKey.has(normalizeLocationKey(entry.label))) {
        continue;
      }

      const location = {
        id: this.createUniqueLocationId(entry.label),
        label: entry.label,
      };
      this.data.locations.push(location);
      locationsByKey.set(normalizeLocationKey(entry.label), location);
      locationsChanged = true;
    }

    const previousUsageByLocationId = new Map(
      this.data.usage.map((usageEntry) => [usageEntry.locationId, usageEntry]),
    );
    const nextUsage: LocationUsage[] = [];

    for (const entry of currentUsageByKey.values()) {
      const location = locationsByKey.get(normalizeLocationKey(entry.label));
      if (!location || entry.count <= 0) {
        continue;
      }

      const previousUsage = previousUsageByLocationId.get(location.id);
      nextUsage.push({
        locationId: location.id,
        count: entry.count,
        firstSeenAt: previousUsage?.firstSeenAt ?? nowIso,
        lastUsedAt: previousUsage?.lastUsedAt ?? nowIso,
      });
    }

    const usageChanged = JSON.stringify(this.data.usage) !== JSON.stringify(nextUsage);
    this.data.usage = nextUsage;
    return locationsChanged || usageChanged;
  }

  public getSettings(): LocationSettings {
    return {
      defaultLocationId: this.data.settings.defaultLocationId,
      pinnedLocationIds: [...this.data.settings.pinnedLocationIds],
      showPopupOnCreate: this.data.settings.showPopupOnCreate,
      autoApplyDefaultWhenOnlyOneChoice: this.data.settings.autoApplyDefaultWhenOnlyOneChoice,
    };
  }

  public getSettingsLabels(): { defaultLocation: string; pinnedLocations: string[] } {
    return {
      defaultLocation: this.getLocationById(this.data.settings.defaultLocationId)?.label ?? '',
      pinnedLocations: this.getPinnedLocations().map((location) => location.label),
    };
  }

  public getLocationById(locationId: string): LocationDefinition | null {
    return this.data.locations.find((location) => location.id === locationId) ?? null;
  }

  public getKnownLocations(): LocationDefinition[] {
    return [...this.data.locations].sort((left, right) => left.label.localeCompare(right.label));
  }

  public getPinnedLocations(): LocationDefinition[] {
    const pinnedLocations = this.data.settings.pinnedLocationIds
      .map((locationId) => this.getLocationById(locationId))
      .filter((location): location is LocationDefinition => location !== null);

    return dedupeLocationsByKey(pinnedLocations);
  }

  public getDefaultLocation(): LocationDefinition | null {
    return this.getLocationById(this.data.settings.defaultLocationId);
  }

  public getTopRecentLocations(limit: number = DEFAULT_RECENT_LIMIT): LocationDefinition[] {
    const recentLocationIds = new Set<string>();
    const topUsageEntries = sortUsageEntries(this.data.usage).slice(0, limit);
    const recentLocations: LocationDefinition[] = [];

    for (const usageEntry of topUsageEntries) {
      if (recentLocationIds.has(usageEntry.locationId)) {
        continue;
      }

      const location = this.getLocationById(usageEntry.locationId);
      if (!location) {
        continue;
      }

      recentLocationIds.add(usageEntry.locationId);
      recentLocations.push(location);
    }

    return recentLocations;
  }

  public getUsageStatistics(): LocationUsageStatistic[] {
    return this.data.usage
      .map((usageEntry) => {
        const location = this.getLocationById(usageEntry.locationId);
        if (!location || usageEntry.count <= 0) {
          return null;
        }

        return {
          locationId: location.id,
          label: location.label,
          count: usageEntry.count,
        };
      })
      .filter((entry): entry is LocationUsageStatistic => entry !== null)
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  }

  public getPromptContext(filePath: string): LocationPromptContext {
    const recentLocations = this.getTopRecentLocations();

    return {
      filePath,
      defaultLocation: recentLocations[0] ?? this.getDefaultLocation(),
      pinnedLocations: this.getPinnedLocations(),
      recentLocations,
      knownLocations: this.getKnownLocations(),
    };
  }

  public resolveLocationInput(rawValue: string): LocationDefinition | null {
    const label = normalizeLocationLabel(rawValue);
    if (!label) {
      return null;
    }

    const normalizedKey = label.toLocaleLowerCase();
    const existingLocation = this.data.locations.find(
      (location) => location.label.toLocaleLowerCase() === normalizedKey,
    );
    if (existingLocation) {
      return existingLocation;
    }

    return {
      id: createLocationId(label),
      label,
    };
  }

  public commitLocation(location: LocationDefinition): LocationDefinition {
    const existingLocation = this.getLocationById(location.id);
    const nowIso = this.clock().toISOString();

    if (!existingLocation) {
      this.data.locations.push({ ...location });
    }

    this.data.settings.pinnedLocationIds = [location.id];

    const usageEntry = this.data.usage.find((entry) => entry.locationId === location.id);
    if (usageEntry) {
      usageEntry.count += 1;
      usageEntry.lastUsedAt = nowIso;
    } else {
      this.data.usage.push({
        locationId: location.id,
        count: 1,
        firstSeenAt: nowIso,
        lastUsedAt: nowIso,
      });
    }

    return existingLocation ?? location;
  }

  public updateSettingsFromLabels(
    defaultLocationLabel: string,
    showPopupOnCreate: boolean,
    autoApplyDefaultWhenOnlyOneChoice: boolean,
  ): void {
    const resolvedDefaultLocation = this.resolveLocationInput(defaultLocationLabel);

    if (resolvedDefaultLocation) {
      if (!this.getLocationById(resolvedDefaultLocation.id)) {
        this.data.locations.push(resolvedDefaultLocation);
      }
      this.data.settings.defaultLocationId = resolvedDefaultLocation.id;
    } else {
      this.data.settings.defaultLocationId = '';
    }

    this.data.settings.pinnedLocationIds = [];
    this.data.settings.showPopupOnCreate = showPopupOnCreate;
    this.data.settings.autoApplyDefaultWhenOnlyOneChoice = autoApplyDefaultWhenOnlyOneChoice;
  }

  public shouldShowPopupOnCreate(): boolean {
    return this.data.settings.showPopupOnCreate;
  }

  public shouldAutoApplyDefault(): boolean {
    return this.data.settings.autoApplyDefaultWhenOnlyOneChoice;
  }

  private createUniqueLocationId(label: string): string {
    const baseId = createLocationId(label);
    let candidateId = baseId;
    let suffix = 2;

    while (this.getLocationById(candidateId)) {
      candidateId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    return candidateId;
  }
}
