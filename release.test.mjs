import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyReleaseImpact,
  packageRelease,
  validateRelease,
} from "./release.mjs";

const temporaryDirectories = [];

function createFixture({
  packageVersion = "1.2.3",
  manifestId = "obsidian-location",
  manifestVersion = packageVersion,
  emptyAsset,
  releaseNotes = `# Release ${packageVersion}\n\nDate: 2026-08-31\n\n## Fixed\n\n- A user-visible fix.\n`,
} = {}) {
  const rootDirectory = mkdtempSync(
    join(tmpdir(), "obsidian-location-release-"),
  );
  temporaryDirectories.push(rootDirectory);
  writeFileSync(
    join(rootDirectory, "package.json"),
    JSON.stringify({ version: packageVersion }),
  );
  writeFileSync(
    join(rootDirectory, "manifest.json"),
    JSON.stringify({
      id: manifestId,
      version: manifestVersion,
      minAppVersion: "1.5.0",
    }),
  );
  writeFileSync(
    join(rootDirectory, "versions.json"),
    JSON.stringify({ [packageVersion]: "1.5.0" }),
  );
  for (const asset of ["main.js", "styles.css"]) {
    writeFileSync(
      join(rootDirectory, asset),
      asset === emptyAsset ? "" : asset,
    );
  }
  if (releaseNotes !== null) {
    const releaseNotesDirectory = join(rootDirectory, "docs", "releases");
    mkdirSync(releaseNotesDirectory, { recursive: true });
    writeFileSync(
      join(releaseNotesDirectory, `${packageVersion}.md`),
      releaseNotes,
    );
  }
  return rootDirectory;
}

function readReleaseTriggerPatterns() {
  const workflow = readFileSync(
    new URL("./.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const triggerBlock = workflow.match(
    /\x20{4}tags:\n((?:\x20{6}- "[^"\n]+"\n?)+)/,
  )?.[1];

  if (!triggerBlock) {
    throw new Error("Release workflow tag trigger is missing");
  }

  return [...triggerBlock.matchAll(/\x20{6}- "([^"\n]+)"/g)].map(
    ([, pattern]) => pattern,
  );
}

function matchesReleaseTrigger(tag, patterns) {
  return patterns.some((pattern) => {
    const regexSource = pattern
      .replace(/[.+?^${}()|\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return new RegExp(`^${regexSource}$`).test(tag);
  });
}

afterEach(() => {
  for (const rootDirectory of temporaryDirectories.splice(0)) {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});

describe("release validation", () => {
  it("aligns trigger patterns and exact validation for semver major versions", () => {
    const triggerPatterns = readReleaseTriggerPatterns();

    expect(triggerPatterns).toEqual([
      "0.[0-9]*.[0-9]*",
      "[1-9]*.[0-9]*.[0-9]*",
    ]);

    for (const version of ["0.2.2", "10.2.3"]) {
      expect(matchesReleaseTrigger(version, triggerPatterns)).toBe(true);
      const rootDirectory = createFixture({ packageVersion: version });
      expect(
        validateRelease({ rootDirectory, expectedVersion: version }).version,
      ).toBe(version);
    }

    expect(matchesReleaseTrigger("01.2.3", triggerPatterns)).toBe(false);
    expect(matchesReleaseTrigger("0.2", triggerPatterns)).toBe(false);
    const rootDirectory = createFixture({ packageVersion: "01.2.3" });
    expect(() =>
      validateRelease({ rootDirectory, expectedVersion: "01.2.3" }),
    ).toThrow("Expected release version is not an X.Y.Z semver");
  });

  it("requires the workflow job to accept only an exact bare tag ref", () => {
    const workflow = readFileSync(
      new URL("./.github/workflows/release.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain('"$GITHUB_REF_TYPE" != "tag"');
    expect(workflow).toContain(
      '"$GITHUB_REF" != "refs/tags/$GITHUB_REF_NAME"',
    );
    expect(workflow).toContain(
      '"$GITHUB_REF_NAME" =~ ^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$',
    );
  });

  it("classifies mixed changes by the highest impact and blocks unknown evidence", () => {
    expect(
      classifyReleaseImpact([
        "docs: clarify the release process",
        "fix: refresh location usage",
      ]),
    ).toBe("patch");
    expect(classifyReleaseImpact(["feat: add a location command", "fix: typo"])).toBe(
      "minor",
    );
    expect(classifyReleaseImpact(["feat!: remove the old location format"])).toBe(
      "major",
    );
    expect(classifyReleaseImpact(["fix: refresh location usage", "ambiguous change"])).toBe(
      "unknown",
    );
    expect(classifyReleaseImpact(["docs: clarify the release process", "test: add coverage"])).toBe(
      "none",
    );
  });

  it("accepts the BRAT release contract for a tag version", () => {
    const rootDirectory = createFixture();

    expect(
      validateRelease({ rootDirectory, expectedVersion: "1.2.3" }),
    ).toMatchObject({
      version: "1.2.3",
      manifestId: "obsidian-location",
    });
  });

  it("packages the current BRAT assets at the ZIP root", () => {
    const rootDirectory = createFixture();

    const result = packageRelease({
      rootDirectory,
      expectedVersion: "1.2.3",
      outputPath: "artifacts/plugin.zip",
    });

    expect(result.assetNames).toEqual(["main.js", "manifest.json", "styles.css"]);
    expect(result.entries).toEqual(result.assetNames);
  });

  it("requires version-specific release notes", () => {
    const rootDirectory = createFixture({ releaseNotes: null });

    expect(() =>
      validateRelease({ rootDirectory, expectedVersion: "1.2.3" }),
    ).toThrow("Release asset is missing or empty");
  });

  it.each([
    ["wrong heading", "# 1.2.3\n\nDate: 2026-08-31\n\n- Fix\n", "heading"],
    ["missing date", "# Release 1.2.3\n\n- Fix\n", "date"],
    [
      "invalid date",
      "# Release 1.2.3\n\nDate: 2026-02-30\n\n- A concrete fix.\n",
      "date",
    ],
    [
      "missing change",
      "# Release 1.2.3\n\nDate: 2026-08-31\n",
      "concrete change",
    ],
    [
      "placeholder change",
      "# Release 1.2.3\n\nDate: 2026-08-31\n\n- update\n",
      "concrete change",
    ],
    [
      "template change",
      "# Release 1.2.3\n\nDate: 2026-08-31\n\n- Documentation-only user-facing change.\n",
      "concrete change",
    ],
  ])("rejects release notes with %s", (_name, releaseNotes, message) => {
    const rootDirectory = createFixture({ releaseNotes });

    expect(() =>
      validateRelease({ rootDirectory, expectedVersion: "1.2.3" }),
    ).toThrow(message);
  });

  it("rejects a manifest id that does not identify this plugin", () => {
    const rootDirectory = createFixture({ manifestId: "other-plugin" });

    expect(() =>
      validateRelease({ rootDirectory, expectedVersion: "1.2.3" }),
    ).toThrow("manifest.json id must be obsidian-location");
  });

  it("rejects an empty release asset", () => {
    const rootDirectory = createFixture({ emptyAsset: "styles.css" });

    expect(() =>
      validateRelease({ rootDirectory, expectedVersion: "1.2.3" }),
    ).toThrow("Release asset is missing or empty");
  });

  it("rejects a release tag that does not match the manifest version", () => {
    const rootDirectory = createFixture();

    expect(() =>
      validateRelease({ rootDirectory, expectedVersion: "1.2.4" }),
    ).toThrow("does not match release tag");
  });

  it("requires the workflow to publish authored release notes", () => {
    const workflow = readFileSync(
      new URL("./.github/workflows/release.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain('--notes-file "$RELEASE_NOTES_PATH"');
    expect(workflow).not.toContain("--generate-notes");
    expect(workflow).toContain(
      'corepack pnpm run release:validate -- "$GITHUB_REF_NAME"',
    );
    expect(workflow).toContain(
      'corepack pnpm run release:package -- "$GITHUB_REF_NAME" "$ZIP_PATH"',
    );
    expect(workflow).toContain(
      "expected_entries=(main.js manifest.json styles.css)",
    );
    expect(workflow).toContain(
      "release_assets=(main.js manifest.json styles.css \"$ZIP_PATH\")",
    );
    expect(workflow).toContain("--verify-tag");
  });
});
