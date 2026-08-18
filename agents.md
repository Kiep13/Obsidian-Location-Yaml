# Obsidian Location

## Purpose

Capture the location where a new note is created and store it in vault frontmatter plus plugin data.

## Architecture

- `src/main.ts` wires services, commands, and settings
- `src/services/` holds location state, note capture, and frontmatter persistence
- `src/ui/` holds the picker modal and settings tab
- `src/utils/` holds pure normalization and ranking helpers

## Boundaries

- UI work stays in `src/ui/` or `src/main.ts`
- Vault/data logic stays in `src/services/`
- Pure string and list helpers stay in `src/utils/`

## Commands

- `corepack pnpm dev`
- `corepack pnpm build`
- `corepack pnpm test`
- `corepack pnpm typecheck`
- `corepack pnpm lint`

## Files

- `manifest.json`
- `install.sh`
- `src/main.ts`
- `src/services/locationStore.ts`
- `src/services/noteLocationService.ts`
- `src/services/locationFrontmatterService.ts`
- `src/ui/locationPickerModal.ts`
- `src/ui/locationSettingTab.ts`

## Risks

- New-note events can race with template/frontmatter writes
- Frontmatter must not be overwritten when the note already has a location
- Location normalization must dedupe case and wiki-link variants
- Data file and frontmatter must stay consistent
