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
