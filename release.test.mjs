import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateRelease } from "./release.mjs";

const temporaryDirectories = [];

function createFixture({
  packageVersion = "1.2.3",
  manifestId = "obsidian-location",
  manifestVersion = packageVersion,
  emptyAsset,
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
    JSON.stringify({ id: manifestId, version: manifestVersion }),
  );
  for (const asset of ["main.js", "styles.css"]) {
    writeFileSync(
      join(rootDirectory, asset),
      asset === emptyAsset ? "" : asset,
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
  const regexSource = patterns
    .map((pattern) => pattern.replaceAll(".", "\\."))
    .join("|");
  return new RegExp(`^(?:${regexSource})$`).test(tag);
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
      "0.[0-9]+.[0-9]+",
      "[1-9][0-9]*.[0-9]+.[0-9]+",
    ]);

    for (const version of ["0.2.2", "10.2.3"]) {
      expect(matchesReleaseTrigger(version, triggerPatterns)).toBe(true);
      const rootDirectory = createFixture({ packageVersion: version });
      expect(
        validateRelease({ rootDirectory, expectedVersion: version }).version,
      ).toBe(version);
    }

    expect(matchesReleaseTrigger("01.2.3", triggerPatterns)).toBe(false);
    const rootDirectory = createFixture({ packageVersion: "01.2.3" });
    expect(() =>
      validateRelease({ rootDirectory, expectedVersion: "01.2.3" }),
    ).toThrow("Expected release version is not an X.Y.Z semver");
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
});
