#!/usr/bin/env node
/**
 * Writes a release version into the three files that declare it. The committed
 * files hold a placeholder, so a release is made by pushing a tag, not by
 * editing them.
 *
 * Usage: node scripts/stamp-version.mjs v1.2.3      (or v1.2.3-beta.1)
 * Prints the version without the leading "v".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isValidVersion } from './version-rules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = String(process.argv[2] ?? '').replace(/^v/, '');

if (!isValidVersion(version)) {
  console.error(`"${process.argv[2]}" is not a release tag. Use v1.2.3 or v1.2.3-beta.1.`);
  process.exit(1);
}

// Replace only the first match, formatting stays untouched. For Cargo.toml
// that is the [package] version, which comes before any dependency.
const stamp = (file, pattern) => {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  if (!pattern.test(text)) throw new Error(`Could not find a version in ${file}`);
  writeFileSync(path, text.replace(pattern, `$1${version}$2`));
};

stamp('src-tauri/tauri.conf.json', /("version"\s*:\s*")[^"]+(")/);
stamp('package.json', /("version"\s*:\s*")[^"]+(")/);
stamp('src-tauri/Cargo.toml', /(^version\s*=\s*")[^"]+(")/m);

console.log(version);
