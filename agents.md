# Obsidian Location: Agent Instructions

Read this file before changing the repository. The detailed procedures are split
by concern:

- `docs/PLUGIN_DEVELOPMENT.md` — architecture, API contracts, and runtime safety
- `docs/BUILD_AND_TEST.md` — dependency, test, lint, build, and artifact gates
- `docs/RELEASE.md` — versioning, BRAT assets, tags, and GitHub Actions
- `docs/PLUGIN_WORKSPACE.md` — relationship to the parent multi-repository workspace

## Scope and ownership

- `src/main.ts` owns lifecycle wiring, commands, and settings registration.
- `src/services/` owns vault synchronization and persisted location state.
- `src/ui/` owns the picker, statistics modal, and settings tab.
- `src/utils/` contains pure normalization and ranking helpers.
- Keep changes inside the smallest relevant boundary and add a focused regression
  test for every bug fix.

## Non-negotiable runtime rule

`PluginSettingTab` must receive the actual `Plugin` instance as its second
argument. Pass `LocationStore` separately. Never use a cast to make a store or
service look like an Obsidian API object; the real runtime may read required
fields such as `plugin.manifest.name` during construction.

## Picker and freshness rule

The location picker is a custom `Modal`. Its suggestion container must be visible
when `hidden=false`; do not add a permanent `display: none` rule. The list is
rendered on open and recalculated on every input event, keeping the existing
recent/exact-match ranking, five-item limit, keyboard navigation, and mouse
selection behavior. Each visible suggestion exposes a non-layout shortcut badge
from 1 to 5. Forward `Tab` from the input focuses the first visible suggestion,
or `Submit` when there are no results. Suggestions use roving `tabindex`: only
the active suggestion is sequentially tabbable, while arrow navigation can focus
the others; forward `Tab` from the suggestion block focuses `Submit`. Number
shortcuts are handled only while a suggestion is focused, use the current
visible ordering, and ignore modified digits.

Before building a prompt context, refresh vault-derived usage. A vault
modification is not considered synchronized until its `metadataCache.changed`
event has arrived. An unresolved (`null`) file cache must leave the last known
usage untouched rather than being interpreted as an empty location field.

## Required checks

From the repository root, run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck
corepack pnpm run test
corepack pnpm run lint
corepack pnpm run build
corepack pnpm run release:validate -- <X.Y.Z>
```

Before merging or publishing, confirm that the generated root files `main.js`,
`manifest.json`, and `styles.css` are non-empty and that package/manifest/version
metadata agree. Before creating a tag, add the version-specific
`docs/releases/<X.Y.Z>.md` notes file with the exact version/date format and at
least one concrete user-visible change. The release workflow publishes that
file as the GitHub Release body; verify the body and assets after it completes.
Read the release document before creating a tag.
