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
  classifyCommitImpact,
  classifyReleaseImpact,
  nextVersion,
  packageRelease,
  validateRelease,
} from "./release.mjs";

const temporaryDirectories = [];

function validReleaseNotes(version, impact = "patch") {
  const majorSections = impact === "major"
    ? "\n## Breaking changes\n\n- Removed the previous location format.\n\n## Migration\n\n- Migrate existing notes before upgrading.\n"
    : "";
  return `# Release ${version}\n\nDate: 2026-08-31\n\n## Summary\n\nThis release contains a concrete user-visible result.\n\n## Impact\n\n${impact}\n\n## Rationale\n\nThe selected impact follows the compatibility evidence.\n\n## Fixed\n\n- Corrected a user-visible release behavior.${majorSections}`;
}

function createFixture({
  packageVersion = "1.2.3",
  manifestId = "obsidian-location",
  manifestVersion = packageVersion,
  emptyAsset,
  releaseNotes = validReleaseNotes(packageVersion),
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

    expect(triggerPatterns).toEqual(["*"]);

    for (const version of ["0.2.2", "10.2.3"]) {
      expect(matchesReleaseTrigger(version, triggerPatterns)).toBe(true);
      const rootDirectory = createFixture({ packageVersion: version });
      expect(
        validateRelease({ rootDirectory, expectedVersion: version }).version,
      ).toBe(version);
    }

    expect(matchesReleaseTrigger("v0.2.2", triggerPatterns)).toBe(true);
    expect(matchesReleaseTrigger("0.2", triggerPatterns)).toBe(true);
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

  it.each([
    ["breaking: remove the old location format", "major"],
    ["feat!: remove the old location format", "major"],
    ["feat: add a location command\n\nBREAKING CHANGE: migrate old notes", "major"],
    ["feat: add a location command\n\nBREAKING-CHANGE: migrate old notes", "major"],
    ["feat: add a location command", "minor"],
    ["fix: refresh location usage", "patch"],
    ["perf: speed up location lookup", "patch"],
    ["docs: clarify the release process", "none"],
    ["test: add classifier coverage", "none"],
    ["chore: update development tooling", "none"],
    ["ci: update workflow", "none"],
    ["build: refresh generated assets", "none"],
    ["refactor: simplify release code", "none"],
    ["style: format release code", "none"],
    ["feat: add a command\n\nBREAKING CHANGE:", "unknown"],
    ["feat: add a command\nBREAKING CHANGE: migrate old notes", "unknown"],
  ])("classifies %s as %s", (message, impact) => {
    expect(classifyCommitImpact(message)).toBe(impact);
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

  it("maps every impact exactly, including 0.x versions", () => {
    expect(nextVersion("0.2.7", "major")).toBe("1.0.0");
    expect(nextVersion("0.2.7", "minor")).toBe("0.3.0");
    expect(nextVersion("0.2.7", "patch")).toBe("0.2.8");
    expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
    expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
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
    ["wrong heading", validReleaseNotes("1.2.3").replace("# Release 1.2.3", "# 1.2.3"), "heading"],
    ["missing date", validReleaseNotes("1.2.3").replace("Date: 2026-08-31\n\n", ""), "date"],
    [
      "invalid date",
      validReleaseNotes("1.2.3").replace("Date: 2026-08-31", "Date: 2026-02-30"),
      "date",
    ],
    [
      "missing Summary",
      validReleaseNotes("1.2.3").replace("## Summary\n\nThis release contains a concrete user-visible result.\n\n", ""),
      "## Summary",
    ],
    [
      "missing Impact",
      validReleaseNotes("1.2.3").replace("## Impact\n\npatch\n\n", ""),
      "## Impact",
    ],
    [
      "missing Rationale",
      validReleaseNotes("1.2.3").replace("## Rationale\n\nThe selected impact follows the compatibility evidence.\n\n", ""),
      "## Rationale",
    ],
    [
      "missing change",
      validReleaseNotes("1.2.3").replace("## Fixed\n\n- Corrected a user-visible release behavior.", ""),
      "concrete change",
    ],
    [
      "placeholder change",
      validReleaseNotes("1.2.3").replace("- Corrected a user-visible release behavior.", "- update"),
      "concrete change",
    ],
    [
      "template change",
      validReleaseNotes("1.2.3").replace("- Corrected a user-visible release behavior.", "- Documentation-only user-facing change."),
      "concrete change",
    ],
  ])("rejects release notes with %s", (_name, releaseNotes, message) => {
    const rootDirectory = createFixture({ releaseNotes });

    expect(() =>
      validateRelease({ rootDirectory, expectedVersion: "1.2.3" }),
    ).toThrow(message);
  });

  it("requires the notes Impact to match the selected release impact", () => {
    const rootDirectory = createFixture();

    expect(() =>
      validateRelease({
        rootDirectory,
        expectedVersion: "1.2.3",
        expectedImpact: "minor",
      }),
    ).toThrow("does not match prepared impact");
  });

  it("requires breaking changes and migration sections for major notes", () => {
    const rootDirectory = createFixture({
      releaseNotes: validReleaseNotes("1.2.3", "major"),
    });

    expect(
      validateRelease({
        rootDirectory,
        expectedVersion: "1.2.3",
        expectedImpact: "major",
      }).impact,
    ).toBe("major");

    const missingMigration = validReleaseNotes("1.2.3", "major").replace(
      /\n## Migration[\s\S]*$/,
      "",
    );
    const invalidRoot = createFixture({ releaseNotes: missingMigration });
    expect(() =>
      validateRelease({ rootDirectory: invalidRoot, expectedVersion: "1.2.3" }),
    ).toThrow("Major release notes must contain ## Migration");
  });

  it("accepts User-visible changes as the concrete change section", () => {
    const rootDirectory = createFixture({
      releaseNotes: validReleaseNotes("1.2.3").replace(
        "## Fixed\n\n- Corrected a user-visible release behavior.",
        "## User-visible changes\n\n- Added a visible location suggestion command.",
      ),
    });

    expect(validateRelease({ rootDirectory, expectedVersion: "1.2.3" }).impact).toBe("patch");
  });

  it("rejects breaking changes sections for non-major notes", () => {
    const rootDirectory = createFixture({
      releaseNotes: validReleaseNotes("1.2.3")
        .replace("## Fixed", "## Breaking changes\n\n- Removed the old location format.\n\n## Fixed"),
    });

    expect(() => validateRelease({ rootDirectory, expectedVersion: "1.2.3" }))
      .toThrow("## Breaking changes is only valid for major impact");
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
    expect(workflow).toContain(
      'gh release view "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --json tagName,body,assets',
    );
    expect(workflow).toContain(
      'mapfile -t release_asset_names < <(jq -r \'.assets[].name\' "$RELEASE_JSON")',
    );
    expect(workflow).toContain('jq -r \'.tagName\' "$RELEASE_JSON"');
    expect(workflow).toContain('jq -r \'.body\' "$RELEASE_JSON"');
  });
});
