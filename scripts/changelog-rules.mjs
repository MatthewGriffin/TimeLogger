/**
 * The rules for CHANGELOG.md, separate from changelog.mjs so that they can be
 * tested. Each version is a "## 0.8.3" heading followed by "- " lines.
 */
import { compareVersions, isBetaVersion, isValidVersion } from './version-rules.mjs';

// Enough for anyone updating from a few versions back, without the manifest growing forever.
const MANIFEST_ENTRIES = 10;

export function parseChangelog(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      entries.push({ version: heading[1], changes: [] });
    } else if (entries.length && line.startsWith('- ')) {
      entries.at(-1).changes.push(line.slice(2).trim());
    }
  }
  return entries;
}

/** Returns what's wrong with the changelog for this version, or null. */
export function changelogProblem(text, version) {
  const entries = parseChangelog(text);
  const invalid = entries.find((entry) => !isValidVersion(entry.version));
  if (invalid) return `CHANGELOG.md has a heading that isn't a version: "## ${invalid.version}".`;
  const entry = entries.find((candidate) => candidate.version === version);
  if (!entry) return `CHANGELOG.md has no "## ${version}" section. Add one saying what changed for users.`;
  if (!entry.changes.length) return `CHANGELOG.md has no "- " lines under "## ${version}".`;
  return null;
}

const format = (entry) => entry.changes.map((change) => `- ${change}`).join('\n');

/** The notes on this version's GitHub release. */
export function releaseNotes(text, version) {
  const entry = parseChangelog(text).find((candidate) => candidate.version === version);
  if (!entry) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  return format(entry);
}

/**
 * The notes in this version's update manifest, newest first. The app shows the
 * sections newer than the installed version. Betas are left out of a full
 * release, because its own entry already sums them up for main users.
 */
export function manifestNotes(text, version) {
  return parseChangelog(text)
    .filter((entry) => compareVersions(entry.version, version) <= 0)
    .filter((entry) => isBetaVersion(version) || !isBetaVersion(entry.version))
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, MANIFEST_ENTRIES)
    .map((entry) => `## ${entry.version}\n${format(entry)}`)
    .join('\n\n');
}
