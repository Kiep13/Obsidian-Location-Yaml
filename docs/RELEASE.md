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

From a clean target branch, use the version helper for a patch or minor release:

```bash
corepack pnpm run release:patch
# or
corepack pnpm run release:minor
```

The `preversion` hook runs typecheck, tests, lint, and a production build. The
`version` hook updates `manifest.json` and `versions.json` from the new
`package.json` version and stages the generated release files. The local helper
does not push tags or publish a GitHub Release.

To validate or package an already selected version without publishing:

```bash
corepack pnpm run release:validate -- <X.Y.Z>
corepack pnpm run release:package -- <X.Y.Z> artifacts/obsidian-location-<X.Y.Z>.zip
```

## GitHub Actions flow

`.github/workflows/release.yml` runs for an exact semver tag without a `v`
prefix. It checks out the tag, installs with the frozen lockfile, runs
typecheck/tests/lint/build, validates the manifest and assets, creates the
root-layout ZIP, and creates or updates the GitHub Release with `GITHUB_TOKEN`.

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
