#!/usr/bin/env node
/**
 * Writes the notes for a release from CHANGELOG.md.
 *
 * Usage:
 *   node scripts/changelog.mjs manifest <version> <output file>
 *   node scripts/changelog.mjs release <version> <output file>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { changelogProblem, manifestNotes, releaseNotes } from './changelog-rules.mjs';

const [kind, version, output] = process.argv.slice(2);
const build = { manifest: manifestNotes, release: releaseNotes }[kind];

if (!build || !version || !output) {
  console.error('Usage: node scripts/changelog.mjs <manifest|release> <version> <output file>');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

const problem = changelogProblem(text, version);
if (problem) {
  console.error(problem);
  process.exit(1);
}

writeFileSync(output, build(text, version));
