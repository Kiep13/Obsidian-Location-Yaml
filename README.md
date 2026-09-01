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
matches on every keystroke. Each visible suggestion has a non-layout shortcut
badge (`1` through `5`). Forward `Tab` moves from the input to the first visible
suggestion, or directly to `Submit` when there are no results; forward `Tab` from
the suggestion block moves to `Submit`. Arrow keys keep all suggestions
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

Before every release, add a user-visible summary to
`docs/releases/<X.Y.Z>.md`. Use the same summary as the GitHub Release body;
the release process is documented in [`docs/RELEASE.md`](docs/RELEASE.md).

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

For a patch or minor release, run the corresponding command from the repository
root to update the local version and build a validation package:

```bash
corepack pnpm run release:patch
corepack pnpm run release:minor
```

Each command runs typecheck, tests, lint, and the production build before
bumping the version. The version hook updates `manifest.json` and
`versions.json`. The local `release:validate` and `release:package` scripts do
not push or publish anything; GitHub Actions creates or updates the Release
when an `X.Y.Z` tag is pushed.
