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
export const RELEASE_PROVENANCE_REQUIRED_ASSETS = ["main.js"];
export const RELEASE_PROVENANCE_OPTIONAL_ASSETS = ["styles.css"];
export const RELEASE_MANIFEST_ID = "obsidian-location";
export const RELEASE_NOTES_DIRECTORY = join("docs", "releases");
export const RELEASE_IMPACTS = ["major", "minor", "patch", "none", "unknown"];
const RELEASE_BUMP_IMPACTS = ["patch", "minor", "major"];
export const LEGACY_RELEASE_VERSION = "0.2.7";
export const SEMVER_TAG_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

const NOTE_PLACEHOLDER =
  /^(?:user-visible (?:addition|behavior change|bug fix|change|changes)|documentation-only user-facing change|required only when applicable|update|todo)\.?$/iu;
const COMMIT_HEADER = /^([a-z]+)(?:\([^\r\n()]+\))?(!)?: [^\s\r\n].*$/i;
const BREAKING_MARKER = /^BREAKING(?: |-)CHANGE\b/i;
const BREAKING_FOOTER = /^BREAKING(?: |-)CHANGE\s*:\s*\S.*$/i;
const COMMIT_IMPACTS = new Map([
  ["breaking", "major"],
  ["feat", "minor"],
  ["fix", "patch"],
  ["perf", "patch"],
  ["docs", "none"],
  ["test", "none"],
  ["tests", "none"],
  ["chore", "none"],
  ["ci", "none"],
  ["build", "none"],
  ["refactor", "none"],
  ["style", "none"],
]);
const RELEASE_NOTE_CANONICAL_SECTIONS = [
  "Summary",
  "User-visible changes",
  "Breaking changes",
  "Migration",
];
const RELEASE_NOTE_SECTIONS = RELEASE_NOTE_CANONICAL_SECTIONS;
const RELEASE_NOTE_INLINE_FIELDS = ["Impact", "Rationale"];
const RELEASE_NOTE_ORDERS = [
  [
    "Impact",
    "Rationale",
    "Summary",
    "User-visible changes",
    "Breaking changes",
    "Migration",
  ],
];
const LEGACY_RELEASE_NOTE_SECTIONS = [
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
const LEGACY_NOTE_CHANGE_SECTIONS = new Set([
  "Added",
  "Changed",
  "Fixed",
  "Documentation",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
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

function assertExactVersion(version, label) {
  if (typeof version !== "string" || !SEMVER_TAG_PATTERN.test(version)) {
    throw new Error(`Expected ${label} is not an X.Y.Z semver: ${version}`);
  }
}

function noteSections(notes, allowedSections = RELEASE_NOTE_SECTIONS) {
  const sections = new Map();
  let currentSection;
  let sawTitle = false;
  let sawDate = false;
  let inlineField;
  for (const line of notes.split(/\r?\n/)) {
    if (line === "") {
      if (currentSection) currentSection.push(line);
      continue;
    }
    if (line.startsWith("# ")) {
      if (sawTitle || sections.size > 0 || sawDate) {
        throw new Error("Release notes contain an unexpected heading");
      }
      sawTitle = true;
      continue;
    }
    const date = line.match(/^Date: (\d{4}-\d{2}-\d{2})$/);
    if (date) {
      if (!sawTitle || sawDate || sections.size > 0) {
        throw new Error(
          "Release notes Date must appear once before note fields",
        );
      }
      sawDate = true;
      continue;
    }
    if (/^Date\s*:/.test(line)) {
      throw new Error("Release notes date is missing or invalid");
    }
    const inline = line.match(
      new RegExp(
        `^(${RELEASE_NOTE_INLINE_FIELDS.join("|")}):(?:[ \\t]+(.*))?$`,
      ),
    );
    if (inline) {
      const [, heading, value] = inline;
      if (!sawDate)
        throw new Error("Release notes fields must follow the Date line");
      if (sections.has(heading)) {
        throw new Error(`Release notes contain duplicate section: ${heading}`);
      }
      currentSection = [];
      sections.set(heading, currentSection);
      inlineField = heading;
      if (value !== undefined && value.trim() !== "")
        currentSection.push(value);
      continue;
    }
    const heading = line.match(/^## (.+)$/)?.[1];
    if (heading) {
      if (!sawDate)
        throw new Error("Release note sections must follow the Date line");
      if (!allowedSections.includes(heading)) {
        throw new Error(
          `Release notes contain an unsupported section: ${heading}`,
        );
      }
      if (sections.has(heading)) {
        throw new Error(`Release notes contain duplicate section: ${heading}`);
      }
      currentSection = [];
      sections.set(heading, currentSection);
      inlineField = undefined;
    } else if (line.startsWith("#")) {
      throw new Error("Release notes contain an unexpected heading");
    } else if (!sawDate) {
      throw new Error("Release notes contain content before the Date line");
    } else if (!currentSection) {
      throw new Error("Release notes contain content outside a note section");
    } else if (inlineField) {
      throw new Error(
        "Inline release note fields must contain one line of text",
      );
    } else {
      currentSection.push(line);
    }
  }
  return sections;
}

function nonEmptyLines(lines) {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function assertReleaseNotes(rootDirectory, version, expectedImpact) {
  const notesPath = join(
    rootDirectory,
    RELEASE_NOTES_DIRECTORY,
    `${version}.md`,
  );
  assertNonEmptyFile(notesPath);
  const notes = readFileSync(notesPath, "utf8");
  const lines = notes.split(/\r?\n/);
  const heading = lines.find((line) => line.length > 0);
  const dateMatch = notes.match(/^Date: (\d{4}-\d{2}-\d{2})$/m);
  const releaseDate = dateMatch ? new Date(`${dateMatch[1]}T00:00:00Z`) : null;
  if (heading !== `# Release ${version}`) {
    throw new Error(
      `Release notes heading must be # Release ${version}: ${notesPath}`,
    );
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
  const sectionNames = [...sections.keys()];
  for (const required of [
    "Impact",
    "Rationale",
    "Summary",
    "User-visible changes",
  ]) {
    if (!sections.has(required)) {
      const marker = RELEASE_NOTE_INLINE_FIELDS.includes(required)
        ? `${required}:`
        : `## ${required}`;
      throw new Error(`Release notes must contain ${marker}: ${notesPath}`);
    }
    if (nonEmptyLines(sections.get(required)).length === 0) {
      throw new Error(
        `Release notes ${required} must not be empty: ${notesPath}`,
      );
    }
  }
  for (const section of sectionNames) {
    if (
      !RELEASE_NOTE_CANONICAL_SECTIONS.includes(section) &&
      !RELEASE_NOTE_INLINE_FIELDS.includes(section)
    ) {
      throw new Error(
        `Release notes contain an unsupported section: ${section}`,
      );
    }
  }
  const impactLines = nonEmptyLines(sections.get("Impact"));
  const impact = impactLines.length === 1 ? impactLines[0] : null;
  if (!RELEASE_IMPACTS.includes(impact)) {
    throw new Error(
      `Release notes Impact must be one of ${RELEASE_IMPACTS.join(", ")}: ${notesPath}`,
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
        throw new Error(
          `Major release notes must contain ## ${required}: ${notesPath}`,
        );
      }
      if (nonEmptyLines(sections.get(required)).length === 0) {
        throw new Error(
          `Release notes ## ${required} must not be empty: ${notesPath}`,
        );
      }
    }
  } else {
    for (const invalid of ["Breaking changes", "Migration"]) {
      if (sections.has(invalid)) {
        throw new Error(
          `Release notes ## ${invalid} is only valid for major impact: ${notesPath}`,
        );
      }
    }
  }

  const sectionOrderMatches = RELEASE_NOTE_ORDERS.some((order) => {
    const indexes = sectionNames.map((section) => order.indexOf(section));
    return indexes.every(
      (index, position) =>
        index !== -1 && index >= (indexes[position - 1] ?? -1),
    );
  });
  if (!sectionOrderMatches) {
    throw new Error(`Release notes sections are out of order: ${notesPath}`);
  }

  const concreteChange = (sections.get("User-visible changes") ?? []).some(
    (line) => {
      const text = line.match(/^\s*-\s+(.+?)\s*$/)?.[1];
      return (
        text !== undefined && text.length >= 9 && !NOTE_PLACEHOLDER.test(text)
      );
    },
  );
  if (!concreteChange) {
    throw new Error(
      `Release notes must contain a concrete change: ${notesPath}`,
    );
  }
  return { notesPath, notes, impact };
}

function assertLegacyReleaseNotes(rootDirectory, version) {
  const notesPath = join(
    rootDirectory,
    RELEASE_NOTES_DIRECTORY,
    `${version}.md`,
  );
  assertNonEmptyFile(notesPath);
  const notes = readFileSync(notesPath, "utf8");
  if (
    notes.split(/\r?\n/).find((line) => line.length > 0) !==
    `# Release ${version}`
  ) {
    throw new Error(
      `Release notes heading must be # Release ${version}: ${notesPath}`,
    );
  }
  const dateMatch = notes.match(/^Date: (\d{4}-\d{2}-\d{2})$/m);
  const releaseDate = dateMatch ? new Date(`${dateMatch[1]}T00:00:00Z`) : null;
  if (
    !dateMatch ||
    !releaseDate ||
    Number.isNaN(releaseDate.valueOf()) ||
    releaseDate.toISOString().slice(0, 10) !== dateMatch[1]
  ) {
    throw new Error(`Release notes date is missing or invalid: ${notesPath}`);
  }
  const sections = noteSections(notes, LEGACY_RELEASE_NOTE_SECTIONS);
  const concreteChange = [...LEGACY_NOTE_CHANGE_SECTIONS].some((section) =>
    (sections.get(section) ?? []).some((line) => {
      const text = line.match(/^\s*-\s+(.+?)\s*$/)?.[1];
      return (
        text !== undefined && text.length >= 9 && !NOTE_PLACEHOLDER.test(text)
      );
    }),
  );
  if (!concreteChange)
    throw new Error(
      `Release notes must contain a concrete change: ${notesPath}`,
    );
  return { notesPath, notes, impact: undefined, legacy: true };
}

function assertPublishableImpact(impact, notesPath) {
  if (!RELEASE_BUMP_IMPACTS.includes(impact)) {
    throw new Error(
      `Release notes Impact (${impact}) is not publishable; expected major, minor, or patch: ${notesPath}`,
    );
  }
}

function normalizeStructuredCommit(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { recognized: true, message: undefined, malformed: true };
  }

  const messageFields = ["message", "commit", "raw"].filter((field) =>
    Object.hasOwn(input, field),
  );
  const parts = ["header", "body", "footer"].filter((field) =>
    Object.hasOwn(input, field),
  );
  const wrapperFields = ["messages", "commits"].filter((field) =>
    Object.hasOwn(input, field),
  );

  if (messageFields.length > 0) {
    if (
      messageFields.length !== 1 ||
      parts.length > 0 ||
      wrapperFields.length > 0 ||
      typeof input[messageFields[0]] !== "string"
    ) {
      return { recognized: true, message: undefined, malformed: true };
    }
    return {
      recognized: true,
      message: input[messageFields[0]],
      malformed: false,
    };
  }

  if (parts.length > 0) {
    if (
      !Object.hasOwn(input, "header") ||
      typeof input.header !== "string" ||
      wrapperFields.length > 0 ||
      (input.body !== undefined && typeof input.body !== "string") ||
      (input.footer !== undefined && typeof input.footer !== "string")
    ) {
      return { recognized: true, message: undefined, malformed: true };
    }
    return {
      recognized: true,
      message: [input.header, input.body, input.footer]
        .filter((part) => part !== undefined && part !== "")
        .join("\n\n"),
      malformed: false,
    };
  }

  return { recognized: false, message: undefined, malformed: false };
}

function normalizedMessages(input) {
  if (typeof input === "string") {
    return { messages: [input], malformed: false };
  }
  if (Array.isArray(input)) {
    return input.reduce(
      (result, item) => {
        const normalized = normalizedMessages(item);
        result.messages.push(...normalized.messages);
        result.malformed ||= normalized.malformed;
        return result;
      },
      { messages: [], malformed: false },
    );
  }
  if (input && typeof input === "object") {
    const structured = normalizeStructuredCommit(input);
    if (structured.recognized) {
      if (structured.message !== undefined) {
        return { messages: [structured.message], malformed: false };
      }
      const wrapperResults = ["messages", "commits"]
        .filter((field) => Array.isArray(input[field]))
        .map((field) => normalizedMessages(input[field]));
      return {
        messages: wrapperResults.flatMap((result) => result.messages),
        malformed: true,
      };
    }

    const wrapperFields = ["messages", "commits"].filter((field) =>
      Object.hasOwn(input, field),
    );
    if (wrapperFields.length > 0) {
      const wrapperResults = wrapperFields.map((field) =>
        Array.isArray(input[field])
          ? normalizedMessages(input[field])
          : { messages: [], malformed: true },
      );
      return {
        messages: wrapperResults.flatMap((result) => result.messages),
        malformed: wrapperResults.some((result) => result.malformed),
      };
    }
  }
  return { messages: [], malformed: true };
}

function messagesFrom(input) {
  const normalized = normalizedMessages(input);
  return normalized.malformed
    ? [...normalized.messages, undefined]
    : normalized.messages;
}

export function classifyCommitImpact(message) {
  if (typeof message !== "string") {
    const normalized = normalizeStructuredCommit(message);
    if (normalized.malformed || normalized.message === undefined)
      return "unknown";
    message = normalized.message;
  }
  if (typeof message !== "string" || message.trim() === "") return "unknown";
  const lines = message.split(/\r?\n/);
  const match = lines[0].trim().match(COMMIT_HEADER);
  if (!match || !COMMIT_IMPACTS.has(match[1].toLowerCase())) return "unknown";
  const breakingMarkers = lines
    .slice(1)
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter(({ line }) => BREAKING_MARKER.test(line));
  const footerStart = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "",
  );
  const breakingFooter = breakingMarkers.find(
    ({ index }) => footerStart !== -1 && index > footerStart,
  );
  const lastContentIndex = lines.findLastIndex((line) => line.trim() !== "");
  if (
    breakingMarkers.length > 0 &&
    (breakingMarkers.length !== 1 ||
      !breakingFooter ||
      !BREAKING_FOOTER.test(breakingFooter.line) ||
      breakingFooter.index !== lastContentIndex)
  ) {
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

function repositoryHistoryMessages(rootDirectory = process.cwd()) {
  try {
    return execFileSync("git", ["log", "--format=%B%x00"], {
      cwd: rootDirectory,
      encoding: "utf8",
    })
      .split("\0")
      .map((message) => message.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

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
  const mode =
    requireStyles === false ? "optional" : (stylesPolicy ?? "required");
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
  const releaseVersion = expectedVersion ?? metadata.version;
  const legacyRequested = allowLegacyNotes || allowLegacy;
  if (legacyRequested && releaseVersion !== LEGACY_RELEASE_VERSION) {
    throw new Error(
      `Legacy release notes are supported only for ${LEGACY_RELEASE_VERSION}`,
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
  const releaseNotes = legacyRequested
    ? assertLegacyReleaseNotes(root, LEGACY_RELEASE_VERSION)
    : assertReleaseNotes(root, releaseVersion, expectedImpact);
  if (!releaseNotes.legacy)
    assertPublishableImpact(releaseNotes.impact, releaseNotes.notesPath);
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

function isTracked(rootDirectory, relativePath) {
  try {
    return (
      execFileSync("git", ["ls-files", "--error-unmatch", "--", relativePath], {
        cwd: rootDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === relativePath
    );
  } catch {
    return false;
  }
}

function assertTrackedBundleAsset(rootDirectory, relativePath) {
  if (!isTracked(rootDirectory, relativePath)) {
    throw new Error(`Required generated asset is not tracked: ${relativePath}`);
  }
  const assetPath = join(rootDirectory, relativePath);
  assertNonEmptyFile(assetPath);
  const workingTreeHash = execFileSync(
    "git",
    ["hash-object", "--", relativePath],
    { cwd: rootDirectory, encoding: "utf8" },
  ).trim();
  const headHash = execFileSync("git", ["rev-parse", `HEAD:${relativePath}`], {
    cwd: rootDirectory,
    encoding: "utf8",
  }).trim();
  if (workingTreeHash !== headHash) {
    throw new Error(
      `Tracked release asset changed after build: ${relativePath}`,
    );
  }
  try {
    execFileSync("git", ["diff", "--exit-code", "HEAD", "--", relativePath], {
      cwd: rootDirectory,
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      `Tracked release asset differs from the checked-out tag: ${relativePath}`,
    );
  }
}

export function verifyTrackedBundleProvenance({
  rootDirectory = process.cwd(),
} = {}) {
  const root = resolve(rootDirectory);
  for (const relativePath of RELEASE_PROVENANCE_REQUIRED_ASSETS) {
    assertTrackedBundleAsset(root, relativePath);
  }
  const verifiedAssets = [...RELEASE_PROVENANCE_REQUIRED_ASSETS];
  for (const relativePath of RELEASE_PROVENANCE_OPTIONAL_ASSETS) {
    if (isTracked(root, relativePath)) {
      assertTrackedBundleAsset(root, relativePath);
      verifiedAssets.push(relativePath);
    }
  }
  return { rootDirectory: root, assetNames: verifiedAssets };
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
      throw new Error(
        `Release preparation changed an unexpected or staged file: ${path}`,
      );
    }
  }
}

export function nextVersion(current, impact) {
  assertExactVersion(current, "package.json version");
  if (!RELEASE_BUMP_IMPACTS.includes(impact)) {
    throw new Error(`Release impact must be patch, minor, or major: ${impact}`);
  }
  const [major, minor, patch] = current.split(".").map(BigInt);
  if (impact === "major") return `${major + 1n}.0.0`;
  if (impact === "minor") return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
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
  return new Map(
    paths.map((path) => [
      path,
      existsSync(join(rootDirectory, path))
        ? readFileSync(join(rootDirectory, path))
        : null,
    ]),
  );
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
    throw new Error(
      `Release preparation requires explicit --impact: ${impact ?? "missing"}`,
    );
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
  expectedImpact,
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
    expectedImpact,
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
  const entries = execFileSync("unzip", ["-Z1", archivePath], {
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (
    entries.length !== metadata.assetNames.length ||
    entries.some((entry, index) => entry !== metadata.assetNames[index])
  ) {
    throw new Error(
      `Release ZIP layout is not exactly ${metadata.assetNames.join(", ")}`,
    );
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
    else if (argument?.startsWith("--impact="))
      options.impact = argument.slice(9);
    else if (argument === "--message" || argument === "--commit") {
      (options.messages ??= []).push(values[++index]);
    } else if (
      argument?.startsWith("--message=") ||
      argument?.startsWith("--commit=")
    ) {
      (options.messages ??= []).push(argument.slice(argument.indexOf("=") + 1));
    } else if (argument === "--styles-optional")
      options.stylesPolicy = "optional";
    else if (argument === "--allow-legacy") options.allowLegacyNotes = true;
    else if (argument?.startsWith("-"))
      throw new Error(`Unknown release option: ${argument}`);
    else positional.push(argument);
  }
  return { command, positional, options };
}

function runCli() {
  const { command, positional, options } = cliArgs(process.argv.slice(2));
  if (command === "classify") {
    const suppliedMessages = [
      ...(options.messages ?? []),
      ...positional,
    ];
    const messages =
      suppliedMessages.length > 0
        ? suppliedMessages
        : repositoryHistoryMessages();
    console.log(classifyReleaseImpact(messages));
    return;
  }
  if (command === "prepare") {
    if (positional.length)
      throw new Error("prepare accepts impact only through --impact");
    console.log(
      `Release preparation complete -> ${prepareRelease({ impact: options.impact }).version}`,
    );
    return;
  }
  if (command === "provenance") {
    if (positional.length)
      throw new Error("provenance accepts no positional arguments");
    const result = verifyTrackedBundleProvenance();
    console.log(
      `Tracked bundle provenance passed -> ${result.assetNames.join(", ")}`,
    );
    return;
  }
  const expectedVersion = positional[0];
  if (command === "validate") {
    console.log(
      `Release validation passed for ${validateRelease({ expectedVersion, stylesPolicy: options.stylesPolicy, allowLegacyNotes: options.allowLegacyNotes }).version}`,
    );
    return;
  }
  if (command === "package") {
    console.log(
      `Release package created -> ${packageRelease({ expectedVersion, outputPath: positional[1], stylesPolicy: options.stylesPolicy, allowLegacyNotes: options.allowLegacyNotes }).archivePath}`,
    );
    return;
  }
  throw new Error(
    `Unknown release command: ${command}. Use classify, prepare, validate, or package.`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCli();
