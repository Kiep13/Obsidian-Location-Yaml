import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateRelease } from "./release.mjs";

const temporaryDirectories = [];

function createFixture({
  manifestId = "obsidian-location",
  manifestVersion = "1.2.3",
  emptyAsset,
} = {}) {
  const rootDirectory = mkdtempSync(
    join(tmpdir(), "obsidian-location-release-"),
  );
  temporaryDirectories.push(rootDirectory);
  writeFileSync(
    join(rootDirectory, "package.json"),
    JSON.stringify({ version: "1.2.3" }),
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

afterEach(() => {
  for (const rootDirectory of temporaryDirectories.splice(0)) {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});

describe("release validation", () => {
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
