#!/usr/bin/env node

/**
 * Version bump script for Synapse Obsidian plugin.
 *
 * Updates version in all 4 source-of-truth files:
 *   - manifest.json
 *   - package.json
 *   - versions.json
 *   - src/__mocks__/obsidian.ts
 *
 * Git tags are created automatically by CI when manifest.json changes
 * land on main (see .github/workflows/tag-on-version-bump.yml).
 *
 * Usage:
 *   node scripts/version-bump.mjs patch          # 0.1.0 → 0.1.1
 *   node scripts/version-bump.mjs minor          # 0.1.0 → 0.2.0
 *   node scripts/version-bump.mjs major          # 0.1.0 → 1.0.0
 *   node scripts/version-bump.mjs 2.0.0          # explicit version
 *   node scripts/version-bump.mjs --check        # validate consistency only
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const MANIFEST = resolve(root, 'manifest.json');
const PACKAGE = resolve(root, 'package.json');
const VERSIONS = resolve(root, 'versions.json');
const MOCK = resolve(root, 'src/__mocks__/obsidian.ts');

// --- Helpers ----------------------------------------------------------------

function detectIndent(path) {
  const content = readFileSync(path, 'utf8');
  const match = content.match(/^[\t ]+/m);
  return match ? match[0] : '  ';
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJSON(path, data) {
  const indent = detectIndent(path);
  writeFileSync(path, JSON.stringify(data, null, indent) + '\n', 'utf8');
}

function bumpSemver(current, level) {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (level) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: throw new Error(`Unknown bump level: ${level}`);
  }
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

function getMockVersion() {
  const content = readFileSync(MOCK, 'utf8');
  const match = content.match(/manifest\s*=\s*\{[^}]*version:\s*'([^']+)'/);
  return match ? match[1] : null;
}

function setMockVersion(oldVersion, newVersion) {
  const content = readFileSync(MOCK, 'utf8');
  const updated = content.replace(
    `version: '${oldVersion}'`,
    `version: '${newVersion}'`,
  );
  writeFileSync(MOCK, updated, 'utf8');
}

// --- Consistency check ------------------------------------------------------

function checkConsistency() {
  const manifest = readJSON(MANIFEST);
  const pkg = readJSON(PACKAGE);
  const mockVersion = getMockVersion();

  const versions = new Set([manifest.version, pkg.version, mockVersion]);

  if (versions.size !== 1) {
    console.error('Version mismatch detected:');
    console.error(`  manifest.json:            ${manifest.version}`);
    console.error(`  package.json:             ${pkg.version}`);
    console.error(`  src/__mocks__/obsidian.ts: ${mockVersion}`);
    return false;
  }

  const current = manifest.version;
  const versionsMap = readJSON(VERSIONS);
  if (!(current in versionsMap)) {
    console.error(`versions.json is missing entry for current version ${current}`);
    return false;
  }

  console.log(`All files consistent at version ${current}`);
  return true;
}

// --- Main -------------------------------------------------------------------

const args = process.argv.slice(2);
const doCheck = args.includes('--check');
const positional = args.filter(a => !a.startsWith('--'));

if (doCheck) {
  process.exit(checkConsistency() ? 0 : 1);
}

if (positional.length === 0) {
  console.error('Usage: version-bump.mjs <patch|minor|major|x.y.z> [--check]');
  process.exit(1);
}

const input = positional[0];

// Validate consistency before bumping
if (!checkConsistency()) {
  console.error('Fix version inconsistencies before bumping.');
  process.exit(1);
}

const manifest = readJSON(MANIFEST);
const currentVersion = manifest.version;
const newVersion = ['patch', 'minor', 'major'].includes(input)
  ? bumpSemver(currentVersion, input)
  : input;

if (!isValidSemver(newVersion)) {
  console.error(`Invalid version: ${newVersion}`);
  process.exit(1);
}

if (newVersion === currentVersion) {
  console.error(`Version is already ${currentVersion}`);
  process.exit(1);
}

// 1. manifest.json
manifest.version = newVersion;
writeJSON(MANIFEST, manifest);

// 2. package.json
const pkg = readJSON(PACKAGE);
pkg.version = newVersion;
writeJSON(PACKAGE, pkg);

// 3. versions.json — append mapping of new version → minAppVersion
const versionsMap = readJSON(VERSIONS);
versionsMap[newVersion] = manifest.minAppVersion;
writeJSON(VERSIONS, versionsMap);

// 4. src/__mocks__/obsidian.ts
setMockVersion(currentVersion, newVersion);

// Post-bump consistency check
if (!checkConsistency()) {
  console.error('Post-bump consistency check failed — this is a bug in the script.');
  process.exit(1);
}

console.log(`Bumped ${currentVersion} → ${newVersion}`);
