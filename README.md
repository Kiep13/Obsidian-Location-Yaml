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
during synchronization.

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

This repository publishes tagged GitHub Releases for BRAT. The plugin version
in `package.json` and `manifest.json` must match. `versions.json` maps each
plugin version to the minimum supported Obsidian version; for example:

```json
{
  "0.2.2": "1.5.0"
}
```

Version keys and release tags use semver without a `v` prefix.

For a patch or minor release, run the corresponding command from the repository
root:

```bash
corepack pnpm run release:patch
corepack pnpm run release:minor
```

Each command runs typecheck, tests, lint, and the production build before
bumping the version. The version hook updates `manifest.json` and
`versions.json`; the release script pushes the current branch and tag, then
creates a GitHub Release containing `main.js`, `manifest.json`, and
`styles.css`. The release requires an authenticated GitHub CLI with push and
release permissions for `Kiep13/Obsidian-Location-Yaml`.
