# Obsidian Location

Capture the location where new Markdown notes are created and store it in
frontmatter.

## Features

- Prompts for a location when a newly created Markdown note is opened
- Uses the most-used locations as suggestions and falls back to the configured default
- Synchronizes location usage from Markdown frontmatter into the plugin's `data.json`
- Writes the selected location to the fixed `location` frontmatter property as a wiki link
- Reuses normalized existing locations and keeps distinct labels separate
- Provides commands to assign a location to the active note and open location statistics

Automatic prompting applies only when the plugin has finished its initial
startup scan, the option is enabled, and the note is opened within 10 minutes
of creation. Notes that already contain `location` are not overwritten by this
automatic flow. The manual assignment command can overwrite the active note's
existing location.

## Installation

### Install with BRAT

1. Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Run `BRAT: Add a beta plugin for testing`.
3. Enter `Kiep13/Obsidian-Location-Yaml`.

BRAT installs the matching GitHub Release assets `main.js`, `manifest.json`,
and `styles.css`. After installation, enable **Obsidian Location** in
Obsidian community plugins.

### Local installation

From the repository root, build and install the plugin into an existing vault:

```bash
corepack pnpm build
```

```bash
bash install.sh "/path/to/your/vault"
```

## Configuration

Open the plugin settings to edit:

- `Default location`: fallback value for the picker when no usage history is available
- `Show location picker`: enables the automatic new-note flow
- `Auto-apply single choice`: this option is stored in plugin data, but the current implementation does not automatically apply a single choice

The frontmatter property name is fixed as `location`; it is not configurable.

The value written to a note has this form:

```yaml
location: "[[Office]]"
```

The plugin persists its state in `data.json`: `settings` and location
definitions in `locations` are persisted plugin state, while `usage` is derived
from the `location` values in Markdown frontmatter. The plugin reconciles that
usage from scalar and string-array values and does not rewrite existing notes
during synchronization. A picker open first refreshes this vault-derived usage;
after a note modification, synchronization waits for the corresponding metadata
cache update. Saved location definitions may remain as historical suggestions,
while recent ordering reflects the current notes.

The picker is a custom modal with a visible suggestion list. It shows recent
locations when the field is empty and recalculates up to five normalized substring
matches on every keystroke. Shortcut badges (`1` through `5`) are shown as
compact, non-layout overlays only while focus is inside the suggestion block.
Forward `Tab` moves from the input to the first visible suggestion, or directly
to `Submit` when there are no results; forward `Tab` from the suggestion block
moves to `Submit`, hiding the badges. Arrow keys keep all suggestions
arrow-focusable through roving `tabindex`, and a focused suggestion can be chosen
with its displayed number. Modified number keys and numbers typed in the input
are left untouched. `ArrowUp`/`ArrowDown`, `Enter`, `Escape`, and mouse selection
remain supported.

## Commands

- `Assign location to active note` opens the picker for the active Markdown note
- `Open Statistic Modal` synchronizes usage and displays counts and percentages for the top eight locations and, when more than eight locations are represented, an `Other` segment

## Development

```bash
corepack pnpm dev
```

## Testing

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
```

## Release

Before every release, add notes to `docs/releases/<X.Y.Z>.md` with the exact
heading/date, non-empty `Summary` and `User-visible changes` sections, and
non-empty `Impact:` and `Rationale:` inline fields. Add at least one concrete
user-visible change bullet; `major` notes also require
`Breaking changes` and `Migration`, while those sections are invalid for other
impacts. Use the same notes as the GitHub Release body; the
full release process is documented in [`docs/RELEASE.md`](docs/RELEASE.md).

This repository publishes tagged GitHub Releases for BRAT through GitHub
Actions. The plugin version in `package.json` and `manifest.json` must match.
`versions.json` maps each plugin version to the minimum supported Obsidian
version; for example:

```json
{
  "0.2.2": "1.5.0"
}
```

Version keys and release tags use semver without a `v` prefix.

Choose the impact before preparing a release. The policy is:

- `major`: an incompatible user-visible or data/configuration change;
- `minor`: a backward-compatible user-visible capability;
- `patch`: a backward-compatible correction;
- `none`: tests, CI, internal changes, or documentation that do not change the
  shipped plugin contract;
- `unknown`: insufficient evidence. Do not choose a version until the impact
  is explicitly resolved.

For mixed changes, the highest applicable impact wins; `unknown` is a blocker.
The classifier uses the same fixed vocabulary as the release helper: `breaking`,
a `!` header, or a `BREAKING CHANGE:`/`BREAKING-CHANGE:` footer means `major`;
`feat` means `minor`; `fix`/`perf` mean `patch`; `docs`/`test`/`chore`/`ci`/
`build`/`refactor`/`style` mean `none`. A malformed non-empty message means
`unknown`; any unknown in mixed input blocks the result. The classifier is
advisory—the maintainer still supplies the selected impact explicitly:

```bash
corepack pnpm run release:classify -- --message "fix: refresh location usage"
```

The version mapping is exact for all `X.Y.Z`, including `0.x`: `major` becomes
`(X+1).0.0`, `minor` becomes `X.(Y+1).0`, and `patch` becomes `X.Y.(Z+1)`.

From a clean repository root, prepare the selected release locally:

```bash
corepack pnpm run release:patch
corepack pnpm run release:minor
corepack pnpm run release:major
```

These commands require the matching `docs/releases/<X.Y.Z>.md` file, update
`package.json`, `manifest.json`, and `versions.json`, and run typecheck, tests,
lint, and the production build. They leave the changes in the working tree for
review; they do not commit, create tags, push, create/update GitHub Releases,
or upload assets.

The lower-level commands are also local-only:

```bash
corepack pnpm run release:prepare -- --impact patch
corepack pnpm run release:validate -- <X.Y.Z>
corepack pnpm run release:package -- <X.Y.Z> artifacts/obsidian-location-<X.Y.Z>.zip
```

`release:validate` performs read-only checks of the exact bare `X.Y.Z` version,
metadata, authored notes, and non-empty root assets. `release:package` first
performs the same checks and then creates a local ZIP containing exactly
`main.js`, `manifest.json`, and `styles.css` at its root. Neither command
publishes anything. Only the explicitly named GitHub Actions stage runs
`gh release create`/`edit` and uploads the assets after an exact bare version
tag is pushed.

The already-published `0.2.7` notes predate the current required fields. To
validate or package that tag without editing its historical note, pass the
explicit opt-in flag `--allow-legacy`; the flag is restricted to `0.2.7`.
