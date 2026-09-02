import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const RELEASE_REQUIRED_ASSETS = ["main.js", "manifest.json"];
export const RELEASE_ASSETS = [...RELEASE_REQUIRED_ASSETS, "styles.css"];
export const RELEASE_MANIFEST_ID = "obsidian-location";
export const RELEASE_NOTES_DIRECTORY = join("docs", "releases");
export const RELEASE_IMPACTS = ["major", "minor", "patch", "none", "unknown"];
const RELEASE_BUMP_IMPACTS = ["patch", "minor", "major"];
export const LEGACY_RELEASE_VERSION = "0.2.7";
export const SEMVER_TAG_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

const NOTE_PLACEHOLDER = /^(?:user-visible (?:addition|behavior change|bug fix|change|changes)|documentation-only user-facing change|required only when applicable|update|todo)\.?$/iu;
const COMMIT_HEADER = /^([a-z]+)(?:\([^\r\n()]+\))?(!)?: [^\s\r\n].*$/i;
const BREAKING_FOOTER = /^BREAKING(?: |-)CHANGE\s*:\s*\S.*$/i;
const COMMIT_IMPACTS = new Map([
  ["breaking", "major"],
  ["feat", "minor"],
  ["fix", "patch"],
  ["perf", "patch"],
  ["docs", "none"],
  ["test", "none"],
  ["chore", "none"],
  ["ci", "none"],
  ["build", "none"],
  ["refactor", "none"],
  ["style", "none"],
]);
const RELEASE_NOTE_SECTIONS = [
  "Summary",
  "Impact",
  "Rationale",
  "User-visible changes",
  "Added",
  "Changed",
  "Fixed",
  "Breaking changes",
  "Migration",
  "Documentation",
];
const RELEASE_NOTE_CHANGE_SECTIONS = new Set([
  "User-visible changes",
  "Added",
  "Changed",
  "Fixed",
  "Breaking changes",
  "Documentation",
]);
const LEGACY_NOTE_CHANGE_SECTIONS = new Set(["Added", "Changed", "Fixed", "Documentation"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function assertNonEmptyFile(path) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`Release asset is missing or empty: ${path}`);
  }
}

function assertExactVersion(version, label) {
  if (typeof version !== "string" || !SEMVER_TAG_PATTERN.test(version)) {
    throw new Error(`Expected ${label} is not an X.Y.Z semver: ${version}`);
  }
}

function noteSections(notes) {
  const sections = new Map();
  let currentSection;
  for (const line of notes.split(/\r?\n/)) {
    const heading = line.match(/^## (.+)$/)?.[1];
    if (heading) {
      if (!RELEASE_NOTE_SECTIONS.includes(heading)) {
        throw new Error(`Release notes contain an unsupported section: ${heading}`);
      }
      if (sections.has(heading)) {
        throw new Error(`Release notes contain duplicate section: ${heading}`);
      }
      currentSection = [];
      sections.set(heading, currentSection);
    } else if (line.startsWith("#")) {
      if (line.startsWith("# ") && sections.size === 0) continue;
      throw new Error("Release notes contain an unexpected heading");
    } else if (currentSection) {
      currentSection.push(line);
    }
  }
  return sections;
}

function nonEmptyLines(lines) {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function assertReleaseNotes(rootDirectory, version, expectedImpact) {
  const notesPath = join(rootDirectory, RELEASE_NOTES_DIRECTORY, `${version}.md`);
  assertNonEmptyFile(notesPath);
  const notes = readFileSync(notesPath, "utf8");
  const lines = notes.split(/\r?\n/);
  const heading = lines.find((line) => line.length > 0);
  const dateMatch = notes.match(/^Date: (\d{4}-\d{2}-\d{2})$/m);
  const releaseDate = dateMatch ? new Date(`${dateMatch[1]}T00:00:00Z`) : null;
  if (heading !== `# Release ${version}`) {
    throw new Error(`Release notes heading must be # Release ${version}: ${notesPath}`);
  }
  if (
    !dateMatch ||
    !releaseDate ||
    Number.isNaN(releaseDate.valueOf()) ||
    releaseDate.toISOString().slice(0, 10) !== dateMatch[1]
  ) {
    throw new Error(`Release notes date is missing or invalid: ${notesPath}`);
  }
  const sections = noteSections(notes);
  const sectionIndexes = [...sections.keys()].map((section) =>
    RELEASE_NOTE_SECTIONS.indexOf(section),
  );
  if (sectionIndexes.some((index, position) => index < (sectionIndexes[position - 1] ?? -1))) {
    throw new Error(`Release notes sections are out of order: ${notesPath}`);
  }
  for (const required of ["Summary", "Impact", "Rationale"]) {
    if (!sections.has(required)) {
      throw new Error(`Release notes must contain ## ${required}: ${notesPath}`);
    }
    if (nonEmptyLines(sections.get(required)).length === 0) {
      throw new Error(`Release notes ## ${required} must not be empty: ${notesPath}`);
    }
  }
  const impactLines = nonEmptyLines(sections.get("Impact"));
  const impact = impactLines.length === 1 ? impactLines[0] : null;
  if (!RELEASE_BUMP_IMPACTS.includes(impact)) {
    throw new Error(
      `Release notes ## Impact must be exactly major, minor, or patch: ${notesPath}`,
    );
  }
  if (expectedImpact !== undefined && impact !== expectedImpact) {
    throw new Error(
      `Release notes Impact (${impact}) does not match prepared impact (${expectedImpact}): ${notesPath}`,
    );
  }

  if (impact === "major") {
    for (const required of ["Breaking changes", "Migration"]) {
      if (!sections.has(required)) {
        throw new Error(`Major release notes must contain ## ${required}: ${notesPath}`);
      }
      if (nonEmptyLines(sections.get(required)).length === 0) {
        throw new Error(`Release notes ## ${required} must not be empty: ${notesPath}`);
      }
    }
  } else {
    for (const invalid of ["Breaking changes", "Migration"]) {
      if (sections.has(invalid)) {
        throw new Error(`Release notes ## ${invalid} is only valid for major impact: ${notesPath}`);
      }
    }
  }

  const concreteChange = [...RELEASE_NOTE_CHANGE_SECTIONS].some((section) =>
    (sections.get(section) ?? []).some((line) => {
      const text = line.match(/^\s*-\s+(.+?)\s*$/)?.[1];
      return text !== undefined && text.length >= 9 && !NOTE_PLACEHOLDER.test(text);
    }),
  );
  if (!concreteChange) {
    throw new Error(`Release notes must contain a concrete change: ${notesPath}`);
  }
  return { notesPath, notes, impact };
}

function assertLegacyReleaseNotes(rootDirectory, version) {
  const notesPath = join(rootDirectory, RELEASE_NOTES_DIRECTORY, `${version}.md`);
  assertNonEmptyFile(notesPath);
  const notes = readFileSync(notesPath, "utf8");
  if (notes.split(/\r?\n/).find((line) => line.length > 0) !== `# Release ${version}`) {
    throw new Error(`Release notes heading must be # Release ${version}: ${notesPath}`);
  }
  const dateMatch = notes.match(/^Date: (\d{4}-\d{2}-\d{2})$/m);
  const releaseDate = dateMatch ? new Date(`${dateMatch[1]}T00:00:00Z`) : null;
  if (!dateMatch || !releaseDate || Number.isNaN(releaseDate.valueOf()) ||
      releaseDate.toISOString().slice(0, 10) !== dateMatch[1]) {
    throw new Error(`Release notes date is missing or invalid: ${notesPath}`);
  }
  const sections = noteSections(notes);
  const concreteChange = [...LEGACY_NOTE_CHANGE_SECTIONS].some((section) =>
    (sections.get(section) ?? []).some((line) => {
      const text = line.match(/^\s*-\s+(.+?)\s*$/)?.[1];
      return text !== undefined && text.length >= 9 && !NOTE_PLACEHOLDER.test(text);
    }),
  );
  if (!concreteChange) throw new Error(`Release notes must contain a concrete change: ${notesPath}`);
  return { notesPath, notes, impact: undefined, legacy: true };
}

function messagesFrom(input) {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    if (typeof input.message === "string") return [input.message];
    if (Array.isArray(input.messages)) return input.messages;
    if (Array.isArray(input.commits)) return input.commits;
  }
  return [];
}

export function classifyCommitImpact(message) {
  if (typeof message !== "string" || message.trim() === "") return "unknown";
  const lines = message.split(/\r?\n/);
  const match = lines[0].trim().match(COMMIT_HEADER);
  if (!match || !COMMIT_IMPACTS.has(match[1].toLowerCase())) return "unknown";
  const breakingMarkers = lines
    .slice(1)
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter(({ line }) => /^BREAKING(?: |-)CHANGE\b/i.test(line));
  const footerStart = lines.findIndex((line, index) => index > 0 && line.trim() === "");
  const breakingFooter = breakingMarkers.find(({ index }) =>
    footerStart !== -1 && index > footerStart,
  );
  if (breakingMarkers.length > 0 && (
    breakingMarkers.length !== 1 || !breakingFooter || !BREAKING_FOOTER.test(breakingFooter.line)
  )) {
    return "unknown";
  }
  const hasBreakingFooter = breakingFooter !== undefined;
  if (match[2] === "!" || hasBreakingFooter) {
    return "major";
  }
  return COMMIT_IMPACTS.get(match[1].toLowerCase());
}

export function classifyReleaseImpact(input) {
  const impacts = messagesFrom(input).map(classifyCommitImpact);
  if (impacts.length === 0 || impacts.includes("unknown")) return "unknown";
  if (impacts.includes("major")) return "major";
  if (impacts.includes("minor")) return "minor";
  if (impacts.includes("patch")) return "patch";
  return "none";
}

export const classifyImpact = classifyReleaseImpact;

function validateMetadata(rootDirectory) {
  const packageJson = readJson(join(rootDirectory, "package.json"));
  const manifest = readJson(join(rootDirectory, "manifest.json"));
  const versions = readJson(join(rootDirectory, "versions.json"));
  const version = packageJson.version;
  assertExactVersion(version, "package.json version");
  if (manifest.id !== RELEASE_MANIFEST_ID) {
    throw new Error(`manifest.json id must be ${RELEASE_MANIFEST_ID}`);
  }
  if (manifest.version !== version) {
    throw new Error(
      `manifest.json version (${manifest.version}) does not match package.json version (${version})`,
    );
  }
  if (
    typeof manifest.minAppVersion !== "string" ||
    versions[version] !== manifest.minAppVersion
  ) {
    throw new Error(
      `versions.json entry for ${version} must match manifest.json minAppVersion`,
    );
  }
  return { packageJson, manifest, versions, version };
}

function stylesMode(stylesPolicy, requireStyles) {
  const mode = requireStyles === false ? "optional" : stylesPolicy ?? "required";
  if (!["required", "optional"].includes(mode)) {
    throw new Error(`stylesPolicy must be required or optional: ${mode}`);
  }
  return mode;
}

export function validateRelease({
  rootDirectory = process.cwd(),
  expectedVersion,
  expectedImpact,
  stylesPolicy = "required",
  requireStyles,
  allowLegacyNotes = false,
  allowLegacy = false,
} = {}) {
  const root = resolve(rootDirectory);
  const metadata = validateMetadata(root);
  assertExactVersion(expectedVersion ?? metadata.version, "release version");
  if (expectedVersion !== undefined && metadata.version !== expectedVersion) {
    throw new Error(
      `manifest.json version (${metadata.manifest.version}) does not match release tag (${expectedVersion})`,
    );
  }
  const mode = stylesMode(stylesPolicy, requireStyles);
  const assets = [...RELEASE_REQUIRED_ASSETS];
  assets.forEach((asset) => assertNonEmptyFile(join(root, asset)));
  if (mode === "required") {
    assertNonEmptyFile(join(root, "styles.css"));
    assets.push("styles.css");
  } else if (existsSync(join(root, "styles.css"))) {
    assertNonEmptyFile(join(root, "styles.css"));
    assets.push("styles.css");
  }
  const releaseNotes = (allowLegacyNotes || allowLegacy) &&
    (expectedVersion ?? metadata.version) === LEGACY_RELEASE_VERSION
    ? assertLegacyReleaseNotes(root, LEGACY_RELEASE_VERSION)
    : assertReleaseNotes(root, expectedVersion ?? metadata.version, expectedImpact);
  return {
    version: metadata.version,
    manifestId: metadata.manifest.id,
    assetNames: assets,
    assetPaths: assets.map((asset) => join(root, asset)),
    stylesPolicy: mode,
    ...releaseNotes,
  };
}

function gitStatus(rootDirectory) {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: rootDirectory, encoding: "utf8" },
  );
}

function assertClean(rootDirectory) {
  if (gitStatus(rootDirectory).trim() !== "") {
    throw new Error("Release preparation requires a clean working tree");
  }
}

function assertKnownChanges(rootDirectory) {
  const allowed = new Set(["package.json", "manifest.json", "versions.json"]);
  for (const line of gitStatus(rootDirectory).split(/\r?\n/).filter(Boolean)) {
    const path = line.slice(3);
    if (line[0] !== " " || !allowed.has(path)) {
      throw new Error(`Release preparation changed an unexpected or staged file: ${path}`);
    }
  }
}

export function nextVersion(current, impact) {
  assertExactVersion(current, "package.json version");
  if (!RELEASE_BUMP_IMPACTS.includes(impact)) {
    throw new Error(`Release impact must be patch, minor, or major: ${impact}`);
  }
  const [major, minor, patch] = current.split(".").map(Number);
  if (impact === "major") return `${major + 1}.0.0`;
  if (impact === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function runChecks(rootDirectory) {
  for (const script of ["typecheck", "test", "lint", "build"]) {
    execFileSync("corepack", ["pnpm", "run", script], {
      cwd: rootDirectory,
      stdio: "inherit",
    });
  }
}

function snapshots(rootDirectory, paths) {
  return new Map(paths.map((path) => [
    path,
    existsSync(join(rootDirectory, path)) ? readFileSync(join(rootDirectory, path)) : null,
  ]));
}

function restore(rootDirectory, values) {
  for (const [relativePath, value] of values) {
    const path = join(rootDirectory, relativePath);
    if (value === null) rmSync(path, { force: true });
    else writeFileSync(path, value);
  }
}

export function prepareRelease({
  rootDirectory = process.cwd(),
  impact,
  runLocalChecks = true,
} = {}) {
  const root = resolve(rootDirectory);
  if (!RELEASE_BUMP_IMPACTS.includes(impact)) {
    throw new Error(`Release preparation requires explicit --impact: ${impact ?? "missing"}`);
  }
  assertClean(root);
  const current = validateMetadata(root);
  const version = nextVersion(current.version, impact);
  assertReleaseNotes(root, version, impact);
  const releaseFiles = ["package.json", "manifest.json", "versions.json"];
  const saved = snapshots(root, [...releaseFiles, ...RELEASE_ASSETS]);
  try {
    current.packageJson.version = version;
    current.manifest.version = version;
    current.versions[version] = current.manifest.minAppVersion;
    writeJson(join(root, "package.json"), current.packageJson);
    writeJson(join(root, "manifest.json"), current.manifest);
    writeJson(join(root, "versions.json"), current.versions);
    if (runLocalChecks) runChecks(root);
    assertKnownChanges(root);
  } catch (error) {
    restore(root, saved);
    throw error;
  }
  return {
    impact,
    previousVersion: current.version,
    version,
    changedPaths: releaseFiles,
    checks: runLocalChecks ? ["typecheck", "test", "lint", "build"] : [],
  };
}

export function packageRelease({
  rootDirectory = process.cwd(),
  expectedVersion,
  outputPath = join(
    "artifacts",
    `obsidian-location-${expectedVersion ?? readJson(join(rootDirectory, "package.json")).version}.zip`,
  ),
  stylesPolicy = "required",
  requireStyles,
  allowLegacyNotes = false,
  allowLegacy = false,
} = {}) {
  const root = resolve(rootDirectory);
  const metadata = validateRelease({
    rootDirectory: root,
    expectedVersion,
    stylesPolicy,
    requireStyles,
    allowLegacyNotes,
    allowLegacy,
  });
  const archivePath = resolve(root, outputPath);
  mkdirSync(dirname(archivePath), { recursive: true });
  rmSync(archivePath, { force: true });
  execFileSync("zip", ["-q", "-j", archivePath, ...metadata.assetNames], {
    cwd: root,
    stdio: "inherit",
  });
  const entries = execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (
    entries.length !== metadata.assetNames.length ||
    entries.some((entry, index) => entry !== metadata.assetNames[index])
  ) {
    throw new Error(`Release ZIP layout is not exactly ${metadata.assetNames.join(", ")}`);
  }
  return { ...metadata, archivePath, entries };
}

function cliArgs(args) {
  const values = [...args];
  const separator = values.indexOf("--");
  if (separator !== -1) values.splice(separator, 1);
  const command = values.shift() ?? "package";
  const positional = [];
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--impact") options.impact = values[++index];
    else if (argument?.startsWith("--impact=")) options.impact = argument.slice(9);
    else if (argument === "--message" || argument === "--commit") {
      (options.messages ??= []).push(values[++index]);
    } else if (argument?.startsWith("--message=") || argument?.startsWith("--commit=")) {
      (options.messages ??= []).push(argument.slice(argument.indexOf("=") + 1));
    } else if (argument === "--styles-optional") options.stylesPolicy = "optional";
    else if (argument === "--allow-legacy") options.allowLegacyNotes = true;
    else if (argument?.startsWith("-")) throw new Error(`Unknown release option: ${argument}`);
    else positional.push(argument);
  }
  return { command, positional, options };
}

function runCli() {
  const { command, positional, options } = cliArgs(process.argv.slice(2));
  if (command === "classify") {
    console.log(classifyReleaseImpact(options.messages ?? positional));
    return;
  }
  if (command === "prepare") {
    if (positional.length) throw new Error("prepare accepts impact only through --impact");
    console.log(`Release preparation complete -> ${prepareRelease({ impact: options.impact }).version}`);
    return;
  }
  const expectedVersion = positional[0];
  if (command === "validate") {
    console.log(`Release validation passed for ${validateRelease({ expectedVersion, stylesPolicy: options.stylesPolicy, allowLegacyNotes: options.allowLegacyNotes }).version}`);
    return;
  }
  if (command === "package") {
    console.log(`Release package created -> ${packageRelease({ expectedVersion, outputPath: positional[1], stylesPolicy: options.stylesPolicy, allowLegacyNotes: options.allowLegacyNotes }).archivePath}`);
    return;
  }
  throw new Error(`Unknown release command: ${command}. Use classify, prepare, validate, or package.`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCli();
