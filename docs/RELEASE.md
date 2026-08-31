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
2. Run the complete local quality gates and release validation.
3. Commit the release state before creating the tag.
4. Push the commit and exact `X.Y.Z` tag only with explicit authorization.
5. Wait for the workflow and verify the published asset names and sizes.
6. Test installation/update in BRAT and inspect Obsidian DevTools on startup.

Do not force-push release tags, publish from an uncommitted working tree, or
assume a successful build means the Release assets are present.
