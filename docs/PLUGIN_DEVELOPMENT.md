# Plugin Development

## Purpose and architecture

The plugin captures the location where a new Markdown note is created, writes a
normalized value to the note's `location` frontmatter property, and derives usage
statistics from vault metadata.

- `src/main.ts` constructs services, registers lifecycle listeners, commands, and
  the settings tab.
- `src/services/LocationStore.ts` owns normalized definitions, settings, usage,
  and persistence through the plugin data adapter.
- `src/services/LocationVaultSyncService.ts` scans Markdown frontmatter and
  reconciles the current snapshot into the store.
- `src/services/LocationService.ts` handles new-note prompts and frontmatter
  writes.
- `src/services/NewNoteCoordinator.ts` tracks the short new-note prompt window.
- `src/ui/` contains Obsidian UI classes; `src/utils/` contains pure helpers.

## Obsidian API contracts

Use the installed `obsidian` type definitions as the first contract. A
`PluginSettingTab` constructor is `PluginSettingTab(app, plugin)`. The plugin
instance and the domain store are different objects:

```ts
class LocationSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private readonly store: LocationStore) {
    super(app, plugin);
  }
}

this.addSettingTab(new LocationSettingTab(this.app, this, this.locationStore));
```

Do not silence an API mismatch with `as unknown as ...`. Obsidian may read
required fields in a base-class constructor before the tab is displayed. In this
repository the relevant precondition includes plugin metadata such as
`plugin.manifest.name`.

## Frontmatter and synchronization

- The property name is the fixed `location` field.
- Synchronization reads `metadataCache` for every Markdown file and accepts a
  scalar value or a string array.
- Values are normalized and counted once per location key per file.
- Existing note frontmatter is not rewritten by synchronization.
- A metadata change, vault create, delete, or rename schedules a debounced sync;
  the statistics command performs an immediate sync.
- Before an automatic or manual picker is opened, the service performs an
  immediate sync. After a vault modification it waits for the corresponding
  `metadataCache.changed` event, so a prompt does not use a stale metadata
  snapshot. If a file cache is unresolved, the scan is skipped instead of
  clearing usage.
- The store's `usage` is derived from the current vault snapshot, while settings
  and location definitions are persisted plugin state.

`locations` are saved definitions and may retain labels from past assignments.
`usage` is the current vault-derived snapshot. Recent suggestions are calculated
from current usage; saved definitions remain available as known locations. This
separation must not be silently replaced with destructive pruning.

The current usage `count` means the number of current Markdown notes containing
the location, not the number of picker selections. For an empty query, current
count is the primary ordering signal and `lastUsedAt` is only a tie-breaker. For
typed input, the score prefers exact matches, earlier substring positions, and
shorter labels, then adds a fixed boost to locations in the current top-five
usage list. That usage boost can therefore override a small text-relevance
difference; this is the current behavior, not a claim that the ranking is a
pure text-first sort. A count shown beside a suggestion must be labeled as
notes (for example, `3 notes`) so users are not told that it represents recent
usage.
Do not add a rolling 14-day score until the data model records reliable
per-event timestamps; the frontmatter snapshot alone cannot reconstruct them.

## Picker UX contract

`LocationAssignModal` is a custom Obsidian `Modal`, not `SuggestModal`. It shows
the default match when opened, recent locations for an empty field, and up to five
normalized substring matches as the user types. The list is rebuilt on each
`input` event. `ArrowUp`/`ArrowDown`, `Enter`, `Escape`, and mouse selection must
continue to work. CSS must show the suggestion container when it is not hidden;
tests should verify both the rendered list and its visibility state.

When changing this behavior, test missing metadata, malformed values, arrays,
duplicates, renamed files, and persistence failures. Check timers and rejected
promises across `onunload`; a callback must not mutate state after the plugin is
disposed.

## Test-mock rule

Mocks must model runtime preconditions that application code relies on. The
`obsidian.ts` test double therefore needs to reject a settings-tab construction
without a plugin manifest. A test that only verifies TypeScript compilation does
not prove that Obsidian can construct the plugin.

For every new Obsidian class or method, add at least one test for the required
constructor arguments and one behavior-level test for the plugin feature.
