#!/usr/bin/env node
/**
 * Verifies the app version is consistent across the three files that declare
 * it, and (when a baseline is supplied) that it has been increased and has a
 * changelog entry.
 *
 * Usage:
 *   node scripts/check-version.mjs            # consistency only
 *   node scripts/check-version.mjs <baseline> # also require an increase and notes
 *   node scripts/check-version.mjs <baseline> <branch> # and suit the target branch
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { branchVersionProblem, compareVersions, isValidVersion } from './version-rules.mjs';
import { changelogProblem } from './changelog-rules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readTauriVersion() {
  const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  return conf.version;
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return pkg.version;
}

function readCargoVersion() {
  const toml = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8');
  // Only look at [package], so dependency versions are never picked up.
  const pkgSection = toml.split(/^\[/m).find((s) => s.startsWith('package]'));
  const match = pkgSection?.match(/^\s*version\s*=\s*"([^"]+)"/m);
  return match?.[1];
}

const versions = {
  'src-tauri/tauri.conf.json': readTauriVersion(),
  'package.json': readPackageVersion(),
  'src-tauri/Cargo.toml': readCargoVersion(),
};

const errors = [];

for (const [file, version] of Object.entries(versions)) {
  if (!version) {
    errors.push(`Could not read a version from ${file}`);
  } else if (!isValidVersion(version)) {
    errors.push(`${file} version "${version}" is not MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-beta.N`);
  }
}

const canonical = versions['src-tauri/tauri.conf.json'];

if (!errors.length) {
  for (const [file, version] of Object.entries(versions)) {
    if (version !== canonical) {
      errors.push(
        `${file} is ${version} but src-tauri/tauri.conf.json is ${canonical} — these must match`
      );
    }
  }
}

const baseline = process.argv[2];

if (!errors.length && baseline) {
  if (!isValidVersion(baseline)) {
    errors.push(`Baseline version "${baseline}" is not MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-beta.N`);
  } else if (compareVersions(canonical, baseline) <= 0) {
    errors.push(
      `Version must be increased before merging: this branch is ${canonical}, the target is ${baseline}. ` +
        'Bump the version in src-tauri/tauri.conf.json, package.json and src-tauri/Cargo.toml.'
    );
  } else {
    const problem = changelogProblem(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), canonical);
    if (problem) errors.push(problem);
  }
}

const branch = process.argv[3];

if (!errors.length && branch) {
  const problem = branchVersionProblem(canonical, branch);
  if (problem) errors.push(problem);
}

if (errors.length) {
  console.error('Version check failed:\n');
  for (const error of errors) console.error(`  x ${error}`);
  process.exit(1);
}

console.log(`Version check passed: ${canonical}${baseline ? ` (target is ${baseline})` : ''}`);
