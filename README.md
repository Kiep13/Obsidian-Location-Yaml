# Obsidian Location

Capture the location where each new note is created.

## Features

- Shows a location picker when a new markdown note is created
- Offers a default location, pinned locations, and top-5 previously used locations
- Stores new locations in `data.json`
- Writes the selected location into note frontmatter as `location`
- Reuses existing locations instead of duplicating them

## Installation

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
