#!/usr/bin/env node
/**
 * Verifies the app version is consistent across the three files that declare
 * it, and (when a baseline is supplied) that it has been increased.
 *
 * Usage:
 *   node scripts/check-version.mjs            # consistency only
 *   node scripts/check-version.mjs <baseline> # also require an increase
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SEMVER = /^\d+\.\d+\.\d+$/;

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

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
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
  } else if (!SEMVER.test(version)) {
    errors.push(`${file} version "${version}" is not MAJOR.MINOR.PATCH`);
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
  if (!SEMVER.test(baseline)) {
    errors.push(`Baseline version "${baseline}" is not MAJOR.MINOR.PATCH`);
  } else if (compareSemver(canonical, baseline) <= 0) {
    errors.push(
      `Version must be increased before merging: this branch is ${canonical}, main is ${baseline}. ` +
        'Bump the version in src-tauri/tauri.conf.json, package.json and src-tauri/Cargo.toml.'
    );
  }
}

if (errors.length) {
  console.error('Version check failed:\n');
  for (const error of errors) console.error(`  x ${error}`);
  process.exit(1);
}

console.log(`Version check passed: ${canonical}${baseline ? ` (main is ${baseline})` : ''}`);
