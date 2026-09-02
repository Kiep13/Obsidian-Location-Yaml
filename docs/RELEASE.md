# Release

## Release contract

The plugin id is `obsidian-location`. `package.json` and `manifest.json` must
carry the same `X.Y.Z` version. `versions.json` maps that version to the
minimum supported Obsidian version (`1.5.0` for the current project).

The GitHub Release used by BRAT must expose these non-empty assets at its root:

- `main.js`
- `manifest.json`
- `styles.css`

The automated workflow also attaches a ZIP containing exactly those files at the
ZIP root. A Git tag existing on GitHub does not prove that the Release has the
assets BRAT needs; verify both separately.

## Impact policy

Select one impact for the complete change before preparing a version:

- `major` — an incompatible user-visible or data/configuration change;
- `minor` — a backward-compatible user-visible capability;
- `patch` — a backward-compatible correction;
- `none` — tests, CI, internal changes, or documentation that do not change the
  shipped plugin contract;
- `unknown` — the evidence is insufficient. This blocks release preparation.

For a mixed change, use the highest impact in this order:
`unknown` > `major` > `minor` > `patch` > `none`. A `major`/`minor`/`patch`
classification must describe the user-visible effect in the authored notes;
`unknown` must be resolved explicitly before selecting a version. The
`release:classify` command can classify Conventional Commit-style messages,
but it does not change files or select a version for the maintainer:

```bash
corepack pnpm run release:classify -- --message "fix: refresh location usage"
```

## Release notes

Every published version must have a dedicated
`docs/releases/<X.Y.Z>.md` file before its version tag is created. This keeps
each release's explanation separate and makes the exact GitHub Release body
reviewable. Use this structure:

```markdown
# Release X.Y.Z

Date: YYYY-MM-DD

## Summary

One or two sentences describing the user-visible result.

## Added

- User-visible addition.

## Changed

- User-visible behavior change.

## Fixed

- User-visible bug fix.

## Breaking changes

- Required only when applicable.

## Documentation

- Documentation-only user-facing change.
```

Keep only non-empty change categories and include at least one concrete
user-visible change. The file name, `Release X.Y.Z` heading, and ISO date must
match the version being released. The GitHub Release body must use the same
text. Automatically generated GitHub notes do not replace these authored
release notes, and a generic body such as `update` is not sufficient.

## Local release preparation

From a clean target branch, use the version helper for the selected impact:

```bash
corepack pnpm run release:patch
corepack pnpm run release:minor
# or: corepack pnpm run release:minor
# or: corepack pnpm run release:major
```

Each helper requires an explicit impact, a clean working tree, and authored
notes for the next version. It updates `package.json`, `manifest.json`, and
`versions.json`, then runs typecheck, tests, lint, and the production build.
The helper leaves those changes local for review. It does not commit, create a
tag, push, create/update a GitHub Release, or upload assets.

To validate or package an already selected version without publishing:

```bash
corepack pnpm run release:validate -- <X.Y.Z>
corepack pnpm run release:package -- <X.Y.Z> artifacts/obsidian-location-<X.Y.Z>.zip
```

`release:validate` is read-only: it checks the exact bare `X.Y.Z` version,
plugin metadata, version map, authored notes, and all required non-empty root
assets. `release:package` repeats validation and creates a local ZIP whose
only root entries are `main.js`, `manifest.json`, and `styles.css`; it does not
commit, tag, push, create/update a Release, or upload assets.

## GitHub Actions flow

`.github/workflows/release.yml` is the only publication stage. Its glob tag
filters are followed by a shell guard that accepts only an exact bare
`X.Y.Z` tag (no `v` prefix or suffix). It checks out that tag, installs with
the frozen lockfile, runs typecheck/tests/lint/build, validates the manifest,
version map, authored notes, and root assets, creates and checks the
root-layout ZIP, and creates or updates the GitHub Release with `GITHUB_TOKEN`.
The Release body is always read from the tagged
`docs/releases/<X.Y.Z>.md` file; generated notes are not used.

Before pushing a tag, confirm:

```bash
git status --short --branch
git show <X.Y.Z>:manifest.json
git show <X.Y.Z>:main.js | wc -c
git show <X.Y.Z>:styles.css | wc -c
```

After the workflow completes, verify the Release page/API lists all four
assets and that the manifest asset has the expected id and version. If an asset
is missing, repair or rerun the Release upload before reporting the release as
installable.

## Safe publication checklist

1. Review the source diff and generated bundle together.
2. Add `docs/releases/<X.Y.Z>.md` and prepare the matching GitHub Release body.
3. Run the complete local quality gates and release validation.
4. Commit the release state before creating the tag.
5. Push the commit and exact `X.Y.Z` tag only with explicit authorization.
6. Wait for the workflow and verify the published asset names and sizes.
7. Let GitHub Actions create or update the GitHub Release with the
   release-notes summary, then verify its body and assets.
8. Test installation/update in BRAT and inspect Obsidian DevTools on startup.

For UI or metadata-cache fixes, manually open the picker after changing a note's
`location` and verify that the current location appears, suggestions are visible
under the input, and typing narrows the list without requiring a plugin reload.

Do not force-push release tags, publish from an uncommitted working tree, or
assume a successful build means the Release assets are present.
