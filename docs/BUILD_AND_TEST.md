# Build and Test

Run commands from `/Users/vadimnechaev/Workspace/obsidian-plugins/Obsidian-Location-Yaml`.

## Dependencies

The repository uses pnpm through Corepack and pins the package manager in
`package.json` as `pnpm@10.0.0`. Node `22.x` is the supported engine. Install
with the lockfile enforced:

```bash
corepack pnpm install --frozen-lockfile
```

Do not edit generated dependency state by hand. If dependencies change, update
`package.json` and `pnpm-lock.yaml` together and rerun the full checks.

## Local development

```bash
corepack pnpm dev
```

The development build watches `src/main.ts` and writes a non-minified bundle with
an inline source map to `main.js`. `src/styles.css` is copied to the root
`styles.css`.

## Quality gates

```bash
corepack pnpm run typecheck
corepack pnpm run test
corepack pnpm run lint
corepack pnpm run build
```

`typecheck` uses the repository's strict TypeScript configuration. `test` runs
Vitest once with the local Obsidian test double. `lint` covers source, test,
configuration, and release scripts. `build` is the production minified bundle
that Obsidian loads.

After a production build, verify the release boundary:

```bash
test -s main.js
test -s manifest.json
test -s styles.css
corepack pnpm run release:validate -- 0.2.4
```

Replace `0.2.4` with the version under test. Validation checks the package and
manifest versions, manifest id, and non-empty root assets. For a release package:

```bash
corepack pnpm run release:package -- <X.Y.Z> artifacts/obsidian-location-<X.Y.Z>.zip
unzip -Z1 artifacts/obsidian-location-<X.Y.Z>.zip
```

The ZIP must contain exactly `main.js`, `manifest.json`, and `styles.css` at its
root. BRAT installation consumes the three matching GitHub Release assets, not a
source checkout and not a bundle hidden under a nested directory.

For a release, also verify that `docs/releases/<X.Y.Z>.md` exists, is non-empty,
uses the exact `# Release X.Y.Z` heading and `Date: YYYY-MM-DD` line, and has at
least one concrete user-visible change. The file must be present in the tagged
commit and its contents must be used as the GitHub Release body.

## UI and freshness regression checks

The unit suite must cover the complete picker sequence: open with a default,
empty input showing recent items, partial input such as `Brat`, and an exact
input such as `Bratislava`. Assert that the suggestion container is not hidden
when it has results. A CSS rule that leaves `.location-modal-suggestions` at
`display: none` is a release blocker.

The service suite must cover a note changing from one location to another. The
test must model `vault.modify` followed by `metadataCache.changed`; a mock that
re-parses the live vault on every `getFileCache` call is insufficient by itself.
Also test that a `null` metadata cache does not erase the previous usage snapshot
and that pre-prompt synchronization occurs before the prompt callback.

## Review checklist

- The test covers the reported failure, not merely the happy path.
- Obsidian API objects receive the correct runtime object, without unsafe casts.
- The production bundle was rebuilt after source changes.
- `manifest.json`, `package.json`, and `versions.json` are synchronized.
- `docs/releases/<X.Y.Z>.md` has the exact version/date and a non-empty user-facing change.
- Root assets are non-empty and the ZIP layout is correct.
- `git diff --check` is clean and no unrelated generated or local files are staged.
