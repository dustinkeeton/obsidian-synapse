#!/usr/bin/env node
//
// changelog-merge.mjs — resolve a stage 1 sync conflict in CHANGELOG.md only when both sides only add
// lines inside `## [Unreleased]` and add no heading. Keeps main's lines, then the integration branch's.
// Dependency-free, local git only. Exit 0 resolvable (or resolved), 1 hold, 2 usage or git error.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const USAGE = [
  'Usage: node changelog-merge.mjs [-C <dir>] [--path <file>] [--write]',
  '  Run mid-merge: stage 2 (ours) is the integration branch, stage 3 (theirs) is main, stage 1 the merge base.',
  '  -C: the checkout holding the conflicted merge (default: .).  --path: default CHANGELOG.md.',
  '  --write: write the resolved file; without it, print the verdict only. Never stages or commits.',
].join('\n');
const LOCK = '.waffle/waffle.lock.json';
const UNRELEASED = /^## \[Unreleased\]\s*$/;
const H2 = /^## /;
const HEADING = /^(#{1,6}\s|(=+|-+)\s*$)/;
const MARKER = /^(<{7}|={7}|>{7})( |$)/;

class Fail extends Error {}
class Hold extends Error {}

function parseArgs(argv) {
  const out = { dir: '.', path: 'CHANGELOG.md', write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--write') {
      out.write = true;
      continue;
    }
    if (a !== '-C' && a !== '--path') return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (v === undefined || v.startsWith('-')) return { error: `${a} needs a value` };
    out[a === '-C' ? 'dir' : 'path'] = v;
  }
  return out;
}

function makeGit(dir) {
  return (args, { allowFail = false } = {}) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.error || (r.status !== 0 && !allowFail)) throw new Fail(`git ${args.join(' ')}: ${(r.stderr || r.error?.message || '').trim()}`);
    return r.status === 0 ? r.stdout : null;
  };
}

function stage(git, n, file) {
  const body = git(['show', `:${n}:${file}`], { allowFail: true });
  if (body === null) throw new Hold(`${file} has no stage ${n} (not a content conflict on both sides)`);
  if (body.includes('\0')) throw new Hold(`${file} stage ${n} is binary`);
  if (body !== '' && !body.endsWith('\n')) throw new Hold(`${file} stage ${n} does not end with a newline`);
  return body;
}

/** Insertions of `side` against the base: [{ at, lines }], `at` = base line number the lines follow. */
function insertions(git, file, n, side) {
  const out = git(['diff', '--no-color', '--no-ext-diff', '--unified=0', '--inter-hunk-context=0', '--histogram', `:1:${file}`, `:${n}:${file}`]);
  const hunks = [];
  for (const line of out.split('\n')) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (h) {
      if (h[2] !== '0') throw new Hold(`${side} removes or edits a line of ${file} near base line ${h[1]}`);
      hunks.push({ at: Number(h[1]), lines: [] });
    } else if (hunks.length && line.startsWith('+')) hunks.at(-1).lines.push(line.slice(1));
    else if (hunks.length && line.startsWith('-')) throw new Hold(`${side} removes a line of ${file}`);
  }
  for (const { lines } of hunks) {
    const heading = lines.find((l) => HEADING.test(l));
    if (heading !== undefined) throw new Hold(`${side} adds a heading to ${file}: ${JSON.stringify(heading)}`);
  }
  return hunks;
}

function check({ dir, path: file }) {
  const git = makeGit(dir);
  const conflicted = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
  if (!conflicted.includes(file)) throw new Hold(`${file} is not conflicted`);
  const other = conflicted.filter((p) => p !== file && p !== LOCK);
  if (other.length) throw new Hold(`other conflicting path(s): ${other.join(', ')}`);
  const base = stage(git, 1, file);
  const ours = stage(git, 2, file);
  const theirs = stage(git, 3, file);
  const lines = base === '' ? [] : base.slice(0, -1).split('\n');
  const marks = lines.flatMap((l, i) => (UNRELEASED.test(l) ? [i + 1] : []));
  if (marks.length !== 1) throw new Hold(`the merge base has ${marks.length} "## [Unreleased]" headings, not 1`);
  const start = marks[0];
  const nextIdx = lines.findIndex((l, i) => i >= start && H2.test(l));
  const end = nextIdx === -1 ? lines.length + 1 : nextIdx + 1;
  const sides = { main: insertions(git, file, 3, 'main'), integ: insertions(git, file, 2, 'integ') };
  for (const [side, hunks] of Object.entries(sides)) {
    const out = hunks.find((h) => h.at < start || h.at >= end);
    if (out) throw new Hold(`${side} adds lines outside "## [Unreleased]" (after base line ${out.at})`);
  }
  return { file, lines, ours, theirs, ...sides };
}

const BULLET = /^[-*+]\s/;

/** Split added lines into entries: each top-level bullet with its continuation lines; lines before the first bullet are a lead-in. */
const entries = (lines) => lines.reduce((out, l) => (BULLET.test(l) || !out.length ? out.push([l]) : out.at(-1).push(l), out), []);
const body = (e) => e.slice(0, e.findLastIndex((l) => l.trim() !== '') + 1).join('\n');
const same = (a, b) => BULLET.test(a[0]) && body(a) === body(b);
const fuller = (a, b) => (b.length > a.length ? b : a);

/** Walk the base; after each base line emit main's inserted entries, then integ's, keeping a whole entry both start or end with once. */
function merge({ lines, main, integ }) {
  const at = (hunks, i) => hunks.filter((h) => h.at === i).flatMap((h) => h.lines);
  const both = (i) => {
    const m = at(main, i);
    const g = at(integ, i);
    if (m.length === g.length && m.every((l, k) => l === g[k])) return m;
    const me = entries(m);
    const ge = entries(g);
    const n = Math.min(me.length, ge.length);
    let p = 0;
    while (p < n && same(me[p], ge[p])) p++;
    let s = 0;
    while (s < n - p && same(me[me.length - 1 - s], ge[ge.length - 1 - s])) s++;
    const mm = me.slice(p, me.length - s);
    const gm = ge.slice(p, ge.length - s);
    const dup = mm.find((e) => BULLET.test(e[0]) && gm.some((f) => f[0] === e[0]));
    if (dup !== undefined) throw new Hold(`main and integ both add ${JSON.stringify(dup[0])} at the same point, among different entries`);
    const head = me.slice(0, p).map((e, k) => fuller(e, ge[k]));
    const tail = me.slice(me.length - s).map((e, k) => fuller(e, ge[ge.length - s + k]));
    return [...head, ...mm, ...gm, ...tail].flat();
  };
  const out = both(0);
  lines.forEach((l, i) => out.push(l, ...both(i + 1)));
  return out;
}

function run(args) {
  const r = check(args);
  const m = r.main.reduce((n, h) => n + h.lines.length, 0);
  const i = r.integ.reduce((n, h) => n + h.lines.length, 0);
  const merged = merge(r);
  if (merged.some((l) => MARKER.test(l))) throw new Hold(`a side adds a conflict-marker-shaped line to ${r.file}`);
  const counts = `${m} main line(s), ${i} integ line(s)`;
  if (!args.write) {
    console.log(`resolvable: ${r.file} additive conflict (${counts}); rerun with --write`);
    return 0;
  }
  fs.writeFileSync(path.join(args.dir, r.file), merged.length ? `${merged.join('\n')}\n` : '');
  console.log(`resolved: ${r.file} additive conflict auto-resolved (${counts})`);
  return 0;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
if (args.error) {
  console.error(`ERROR: ${args.error}\n${USAGE}`);
  process.exit(2);
}
try {
  process.exit(run(args));
} catch (e) {
  if (e instanceof Hold) {
    console.log(`HOLD: ${e.message}`);
    process.exit(1);
  }
  console.error(`ERROR: ${e instanceof Fail ? e.message : e.stack}`);
  process.exit(2);
}
