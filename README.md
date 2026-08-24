# Obsidian Location

Capture the location where each new note is created.

## Features

- Shows a location picker when a new markdown note is created
- Offers a default location, pinned locations, and top-5 previously used locations
- Synchronizes locations and usage counts from Markdown frontmatter into `data.json`
- Writes the selected location into note frontmatter as `location`
- Reuses existing locations instead of duplicating them
- Keeps differently written location labels separate without rewriting existing notes

## Installation

### Install with BRAT

1. Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Run `BRAT: Add a beta plugin for testing`.
3. Enter `Kiep13/Obsidian-Location-Yaml`.

BRAT installs the matching GitHub Release assets `main.js`, `manifest.json`,
and `styles.css`. After installation, enable **Obsidian Location** in
Obsidian community plugins.

### Local installation

1. Build the plugin:

```bash
corepack pnpm build
```

2. Install into a vault:

```bash
bash install.sh "/path/to/your/vault"
```

## Configuration

Open the plugin settings to edit:

- default location
- pinned locations
- frontmatter field name

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

This repository publishes tagged GitHub Releases for BRAT. The release tag and
the versions in `package.json`, `manifest.json`, and `versions.json` use the
same semver value without a `v` prefix.

For a minor release, run:

```bash
corepack pnpm run release:minor
```

The command runs typecheck, tests, lint, and the production build, bumps the
version, creates the matching Git tag, pushes the commit and tag, and creates a
GitHub Release containing `main.js`, `manifest.json`, and `styles.css`.
The release requires an authenticated GitHub CLI with push and release
permissions for `Kiep13/Obsidian-Location-Yaml`.
