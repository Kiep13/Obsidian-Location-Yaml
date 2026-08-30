import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const RELEASE_ASSETS = ["main.js", "manifest.json", "styles.css"];
export const RELEASE_MANIFEST_ID = "obsidian-location";
export const SEMVER_TAG_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertNonEmptyFile(path) {
  if (
    !existsSync(path) ||
    !statSync(path).isFile() ||
    statSync(path).size === 0
  ) {
    throw new Error(`Release asset is missing or empty: ${path}`);
  }
}

export function validateRelease({
  rootDirectory = process.cwd(),
  expectedVersion,
} = {}) {
  const packageJson = readJson(join(rootDirectory, "package.json"));
  const manifest = readJson(join(rootDirectory, "manifest.json"));
  const packageVersion = packageJson.version;

  if (
    typeof packageVersion !== "string" ||
    packageVersion.trim().length === 0
  ) {
    throw new Error("package.json version is missing or invalid");
  }

  if (typeof manifest.id !== "string" || manifest.id !== RELEASE_MANIFEST_ID) {
    throw new Error(`manifest.json id must be ${RELEASE_MANIFEST_ID}`);
  }

  if (
    typeof manifest.version !== "string" ||
    manifest.version !== packageVersion
  ) {
    throw new Error(
      `manifest.json version (${manifest.version}) does not match package.json version (${packageVersion})`,
    );
  }

  if (expectedVersion !== undefined) {
    if (!SEMVER_TAG_PATTERN.test(expectedVersion)) {
      throw new Error(
        `Expected release version is not an X.Y.Z semver: ${expectedVersion}`,
      );
    }

    if (manifest.version !== expectedVersion) {
      throw new Error(
        `manifest.json version (${manifest.version}) does not match release tag (${expectedVersion})`,
      );
    }
  }

  const assetPaths = RELEASE_ASSETS.map((asset) => join(rootDirectory, asset));
  assetPaths.forEach(assertNonEmptyFile);

  return {
    version: packageVersion,
    manifestId: manifest.id,
    assetPaths,
  };
}

export function packageRelease({
  rootDirectory = process.cwd(),
  expectedVersion,
  outputPath = join(
    "artifacts",
    `obsidian-location-${expectedVersion ?? readJson(join(rootDirectory, "package.json")).version}.zip`,
  ),
} = {}) {
  const metadata = validateRelease({ rootDirectory, expectedVersion });
  const archivePath = resolve(rootDirectory, outputPath);

  mkdirSync(dirname(archivePath), { recursive: true });
  execFileSync("zip", ["-q", "-j", archivePath, ...RELEASE_ASSETS], {
    cwd: rootDirectory,
    stdio: "inherit",
  });

  return { ...metadata, archivePath };
}

function runCli() {
  const cliArguments = process.argv.slice(2);
  const separatorIndex = cliArguments.indexOf("--");
  if (separatorIndex !== -1) {
    cliArguments.splice(separatorIndex, 1);
  }

  const command = cliArguments[0] ?? "package";
  const expectedVersion = cliArguments[1];
  const outputPath = cliArguments[2];

  if (command === "validate") {
    const metadata = validateRelease({ expectedVersion });
    console.log(`Release validation passed for ${metadata.version}`);
    return;
  }

  if (command === "package") {
    const metadata = packageRelease({ expectedVersion, outputPath });
    console.log(`Release package created -> ${metadata.archivePath}`);
    return;
  }

  throw new Error(
    `Unknown release command: ${command}. Use validate or package.`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runCli();
}
