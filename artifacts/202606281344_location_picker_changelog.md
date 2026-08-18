# Changelog

Date: 2026-06-28

## Changed

- Guarded new-note capture until `workspace.onLayoutReady()`, so the location modal no longer opens on Obsidian reload/startup for pre-existing notes.
- Replaced the button-based location picker with an autocomplete dropdown backed by saved plugin locations.
- Empty input now shows up to 5 recent locations.
- Typed input now ranks suggestions by string match.
- `ArrowUp` and `ArrowDown` navigate suggestions.
- `Enter` on a focused suggestion selects it.
- `Enter` in the input submits the current typed value.
- Submitting a new typed location saves it into plugin data.
- Removed manual pinned-location editing from settings.
- `pinned` now tracks exactly one location: the last selected or newly added location.

## Files

- `src/main.ts`
- `src/services/NewNoteCoordinator.ts`
- `src/services/LocationStore.ts`
- `src/ui/LocationAssignModal.ts`
- `src/ui/LocationSettingTab.ts`
- `src/services/LocationService.test.ts`
- `src/services/LocationStore.test.ts`
- `src/ui/LocationAssignModal.test.ts`
- `obsidian.ts`

## Verification

- `corepack pnpm test`
- `corepack pnpm typecheck`
- `corepack pnpm build`
