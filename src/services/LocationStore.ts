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
  normalizeLocationId,
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

type DataRecord = Record<string, unknown>;

function isDataRecord(value: unknown): value is DataRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER);
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function createUniqueLocationId(
  label: string,
  usedIds: Set<string>,
  reservedIds: Set<string> = new Set(),
): string {
  const baseId = createLocationId(label);
  let candidateId = baseId;
  let suffix = 2;

  while (usedIds.has(candidateId) || reservedIds.has(candidateId)) {
    candidateId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidateId;
}

function getStoredLocationId(value: unknown): string {
  return typeof value === 'string' ? normalizeLocationId(value) : '';
}

function resolveMappedLocationId(value: unknown, mapping: Map<string, string>): string {
  if (typeof value !== 'string') {
    return '';
  }

  return mapping.get(value) ?? mapping.get(normalizeLocationId(value)) ?? normalizeLocationId(value);
}

function addLocationIdMapping(mapping: Map<string, string>, rawId: unknown, canonicalId: string): void {
  if (typeof rawId !== 'string') {
    return;
  }

  const normalizedId = getStoredLocationId(rawId);
  if (!normalizedId) {
    return;
  }

  mapping.set(rawId, mapping.get(rawId) ?? canonicalId);
  mapping.set(normalizedId, mapping.get(normalizedId) ?? canonicalId);
}

function mergeLoadedData(loadedData: unknown): LocationData {
  if (!isDataRecord(loadedData)) {
    return cloneData(DEFAULT_DATA);
  }

  const schemaVersion = loadedData.schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== 1) {
    return cloneData(DEFAULT_DATA);
  }

  if (!Array.isArray(loadedData.locations)) {
    return cloneData(DEFAULT_DATA);
  }

  const mergedLocations: LocationDefinition[] = [];
  const canonicalLocationByKey = new Map<string, LocationDefinition>();
  const locationIds = new Set<string>();
  const reservedExplicitIds = new Set<string>();
  const locationIdMapping = new Map<string, string>();

  for (const rawLocation of loadedData.locations) {
    if (!isDataRecord(rawLocation) || typeof rawLocation.id !== 'string') {
      continue;
    }

    const explicitId = getStoredLocationId(rawLocation.id);
    if (explicitId) {
      reservedExplicitIds.add(explicitId);
    }
  }

  for (const rawLocation of loadedData.locations) {
    if (!isDataRecord(rawLocation) || typeof rawLocation.label !== 'string') {
      continue;
    }

    const label = normalizeLocationLabel(rawLocation.label);
    const key = normalizeLocationKey(label);
    if (!key) {
      continue;
    }

    const canonicalLocation = canonicalLocationByKey.get(key);
    if (canonicalLocation) {
      addLocationIdMapping(locationIdMapping, rawLocation.id, canonicalLocation.id);
      continue;
    }

    const loadedId = getStoredLocationId(rawLocation.id);
    const id = loadedId && !locationIds.has(loadedId)
      ? loadedId
      : createUniqueLocationId(label, locationIds, reservedExplicitIds);

    const location = { id, label };
    mergedLocations.push(location);
    canonicalLocationByKey.set(key, location);
    locationIds.add(id);

    addLocationIdMapping(locationIdMapping, rawLocation.id, id);
  }

  const rawSettings = isDataRecord(loadedData.settings) ? loadedData.settings : {};
  const configuredDefaultId = resolveMappedLocationId(rawSettings.defaultLocationId, locationIdMapping);
  const configuredPinnedIds = Array.isArray(rawSettings.pinnedLocationIds)
    ? rawSettings.pinnedLocationIds.map((locationId) => resolveMappedLocationId(locationId, locationIdMapping))
    : [];
  const mergedSettings: LocationSettings = {
    defaultLocationId:
      mergedLocations.find((location) => location.id === configuredDefaultId)?.id ??
      mergedLocations[0]?.id ??
      '',
    pinnedLocationIds: configuredPinnedIds.filter((locationId, index) =>
      locationIds.has(locationId) && configuredPinnedIds.indexOf(locationId) === index,
    ).slice(0, 1),
    showPopupOnCreate: typeof rawSettings.showPopupOnCreate === 'boolean'
      ? rawSettings.showPopupOnCreate
      : DEFAULT_DATA.settings.showPopupOnCreate,
    autoApplyDefaultWhenOnlyOneChoice:
      typeof rawSettings.autoApplyDefaultWhenOnlyOneChoice === 'boolean'
        ? rawSettings.autoApplyDefaultWhenOnlyOneChoice
        : DEFAULT_DATA.settings.autoApplyDefaultWhenOnlyOneChoice,
  };

  const usageByLocationId = new Map<string, LocationUsage>();
  const rawUsage = Array.isArray(loadedData.usage) ? loadedData.usage : [];
  for (const rawUsageEntry of rawUsage) {
    if (!isDataRecord(rawUsageEntry) || typeof rawUsageEntry.locationId !== 'string') {
      continue;
    }

    const locationId = resolveMappedLocationId(rawUsageEntry.locationId, locationIdMapping);
    const count = normalizeCount(rawUsageEntry.count);
    if (!locationIds.has(locationId) || count === null) {
      continue;
    }

    const firstSeenAt = normalizeTimestamp(rawUsageEntry.firstSeenAt);
    const lastUsedAt = normalizeTimestamp(rawUsageEntry.lastUsedAt);
    if (!firstSeenAt && !lastUsedAt) {
      continue;
    }

    const normalizedUsage: LocationUsage = {
      locationId,
      count,
      firstSeenAt: firstSeenAt ?? lastUsedAt!,
      lastUsedAt: lastUsedAt ?? firstSeenAt!,
    };
    const existingUsage = usageByLocationId.get(locationId);
    if (!existingUsage) {
      usageByLocationId.set(locationId, normalizedUsage);
      continue;
    }

    existingUsage.count = Math.min(existingUsage.count + count, Number.MAX_SAFE_INTEGER);
    existingUsage.firstSeenAt = existingUsage.firstSeenAt < normalizedUsage.firstSeenAt
      ? existingUsage.firstSeenAt
      : normalizedUsage.firstSeenAt;
    existingUsage.lastUsedAt = existingUsage.lastUsedAt > normalizedUsage.lastUsedAt
      ? existingUsage.lastUsedAt
      : normalizedUsage.lastUsedAt;
  }

  return {
    schemaVersion: 1,
    settings: mergedSettings,
    locations: mergedLocations,
    usage: [...usageByLocationId.values()],
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
    let nowIso: string | null = null;
    const getNowIso = (): string => {
      nowIso ??= this.clock().toISOString();
      return nowIso;
    };
    const currentUsageByKey = new Map<string, VaultLocationUsage>();

    for (const entry of entries ?? []) {
      if (!entry || typeof entry.label !== 'string') {
        continue;
      }

      const label = normalizeLocationLabel(entry.label);
      const key = normalizeLocationKey(label);
      if (!key || currentUsageByKey.has(key)) {
        continue;
      }

      currentUsageByKey.set(key, {
        label,
        count: normalizeCount(entry.count) ?? 0,
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
        firstSeenAt: previousUsage?.firstSeenAt ?? getNowIso(),
        // Reconcile receives a current count snapshot, not an event timestamp.
        // Preserve the last explicit commit time when the usage already exists.
        lastUsedAt: previousUsage?.lastUsedAt ?? getNowIso(),
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

    const normalizedKey = normalizeLocationKey(label);
    const existingLocation = this.data.locations.find((location) => normalizeLocationKey(location.label) === normalizedKey);
    if (existingLocation) {
      return existingLocation;
    }

    return {
      id: this.createUniqueLocationId(label),
      label,
    };
  }

  public commitLocation(location: LocationDefinition): LocationDefinition {
    const normalizedLabel = normalizeLocationLabel(location.label);
    const rawLocationId = typeof location.id === 'string' ? location.id : '';
    const requestedId = getStoredLocationId(location.id);
    if (rawLocationId && requestedId && rawLocationId !== requestedId) {
      this.remapLocationIdReferences(rawLocationId, requestedId);
    }

    const existingLocationByLabel = this.data.locations.find(
      (knownLocation) => normalizeLocationKey(knownLocation.label) === normalizeLocationKey(normalizedLabel),
    );
    const existingLocationById = this.getLocationById(requestedId);
    const existingLocation = existingLocationByLabel ?? (
      existingLocationById && normalizeLocationKey(existingLocationById.label) === normalizeLocationKey(normalizedLabel)
        ? existingLocationById
        : null
    );
    if (!normalizedLabel) {
      return existingLocationById ?? location;
    }

    const nowIso = this.clock().toISOString();
    const committedLocation = existingLocation ?? {
      id: existingLocationById || !requestedId ? this.createUniqueLocationId(normalizedLabel) : requestedId,
      label: normalizedLabel,
    };

    if (!existingLocation) {
      this.data.locations.push({ ...committedLocation });
    }

    this.data.settings.pinnedLocationIds = [committedLocation.id];

    const usageEntry = this.data.usage.find((entry) => entry.locationId === committedLocation.id);
    if (usageEntry) {
      usageEntry.count += 1;
      usageEntry.lastUsedAt = nowIso;
    } else {
      this.data.usage.push({
        locationId: committedLocation.id,
        count: 1,
        firstSeenAt: nowIso,
        lastUsedAt: nowIso,
      });
    }

    return committedLocation;
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
    return createUniqueLocationId(label, new Set(this.data.locations.map((location) => location.id)));
  }

  private remapLocationIdReferences(oldLocationId: string, newLocationId: string): void {
    if (!oldLocationId || oldLocationId === newLocationId) {
      return;
    }

    const normalizedOldLocationId = normalizeLocationId(oldLocationId);
    const isOldLocationId = (locationId: string): boolean =>
      normalizeLocationId(locationId) === normalizedOldLocationId;

    if (isOldLocationId(this.data.settings.defaultLocationId)) {
      this.data.settings.defaultLocationId = newLocationId;
    }

    this.data.settings.pinnedLocationIds = this.data.settings.pinnedLocationIds.map((locationId) =>
      isOldLocationId(locationId) ? newLocationId : locationId,
    );

    const usageByLocationId = new Map<string, LocationUsage>();
    for (const usageEntry of this.data.usage) {
      const locationId = isOldLocationId(usageEntry.locationId) ? newLocationId : usageEntry.locationId;
      const existingUsage = usageByLocationId.get(locationId);
      if (!existingUsage) {
        usageByLocationId.set(locationId, { ...usageEntry, locationId });
        continue;
      }

      existingUsage.count = Math.min(existingUsage.count + usageEntry.count, Number.MAX_SAFE_INTEGER);
      existingUsage.firstSeenAt = existingUsage.firstSeenAt < usageEntry.firstSeenAt
        ? existingUsage.firstSeenAt
        : usageEntry.firstSeenAt;
      existingUsage.lastUsedAt = existingUsage.lastUsedAt > usageEntry.lastUsedAt
        ? existingUsage.lastUsedAt
        : usageEntry.lastUsedAt;
    }

    this.data.usage = [...usageByLocationId.values()];
  }
}
