#!/usr/bin/env node
//
// overwrites.mjs — did a later change drop lines an earlier PR added? Two modes, see USAGE.
// History mode judges the commit that removed each line; --rebase checks one pre-gate rebase.
// Dependency-free, local git only. Exit 0 clean, 1 findings, 2 usage or git error.

import { spawnSync } from 'node:child_process';

const USAGE = [
  'Usage: node overwrites.mjs --head <sha> --pr <label>=<sha> [--pr <label>=<sha> …] [--ignore <path> …]',
  '       node overwrites.mjs --rebase --before <sha> --after <sha> --onto <sha> [--ignore <path> …]',
  "  --pr: a run PR's merge commit on --head's first-parent history, any order; a numeric label prints as #N.",
  '  --rebase: a line --onto holds that --after lacks was dropped resolving the rebase, unless it predates',
  "            --before's fork and a replayed (non-merge) branch commit removed it.",
].join('\n');
const DEFAULT_IGNORES = ['.waffle/waffle.lock.json'];
const SHOW_PER_GROUP = 5;
const MAX_WALK = 1000;
const VALUED = ['--head', '--pr', '--ignore', '--before', '--after', '--onto'];

class Fail extends Error {}

function git(args) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) throw new Fail(`git ${args.join(' ')}: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout;
}

function parseArgs(argv) {
  const out = { prs: [], ignores: [...DEFAULT_IGNORES] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--rebase') {
      out.rebase = true;
      continue;
    }
    if (!VALUED.includes(a)) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    if (a === '--ignore') out.ignores.push(v);
    else if (a === '--pr') {
      const m = /^([^=\s]+)=(\S+)$/.exec(v);
      if (!m) return { error: `--pr wants <label>=<sha>, got ${v}` };
      out.prs.push({ label: /^\d+$/.test(m[1]) ? `#${m[1]}` : m[1], ref: m[2] });
    } else out[a.slice(2)] = v;
  }
  if (out.rebase) {
    if (out.head || out.prs.length) return { error: '--rebase takes --before, --after and --onto, not --head or --pr' };
    const missing = ['before', 'after', 'onto'].find((k) => !out[k]);
    return missing ? { error: `--rebase needs --${missing}` } : out;
  }
  if (out.before || out.after || out.onto) return { error: '--before, --after and --onto need --rebase' };
  if (!out.head) return { error: '--head is required' };
  if (!out.prs.length) return { error: 'at least one --pr is required' };
  return out;
}

const resolve = (ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
const isAncestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b]).status === 0;

function unquote(p) {
  if (!p.startsWith('"')) return p;
  const esc = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
  return p.slice(1, -1).replace(/\\(["\\nt])/g, (_, c) => esc[c]);
}

// Header paths: `--- a/x`, `+++ b/x`, `/dev/null`; git appends a tab to a name with spaces.
const headerPath = (rest) => (rest === '/dev/null' ? null : unquote(rest.replace(/\t$/, '')).slice(2));

/** The net change from `from` to `to`: per file, its old/new path and the +/- lines. */
function changes(from, to) {
  const out = git(['diff', '-M', '--unified=0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', from, to]);
  const files = [];
  let f = null;
  let inHunk = false;
  for (const line of out.split('\n')) {
    if (line.startsWith('diff --git ')) {
      f = { from: null, to: null, added: [], removed: [], deleted: false };
      files.push(f);
      inHunk = false;
    } else if (!f) continue;
    else if (!inHunk && line.startsWith('rename from ')) f.from = unquote(line.slice(12));
    else if (!inHunk && line.startsWith('rename to ')) f.to = unquote(line.slice(10));
    else if (!inHunk && line.startsWith('deleted file mode')) f.deleted = true;
    else if (!inHunk && line.startsWith('--- ')) f.from = headerPath(line.slice(4));
    else if (!inHunk && line.startsWith('+++ ')) f.to = headerPath(line.slice(4));
    else if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && line.startsWith('+')) f.added.push(line.slice(1));
    else if (inHunk && line.startsWith('-')) f.removed.push(line.slice(1));
  }
  return files;
}

/** Renames and deletes from `a` to `b`, as old path → new path (null when deleted). */
function moves(a, b) {
  const parts = git(['diff', '-M', '--name-status', '-z', a, b]).split('\0');
  const moved = new Map();
  for (let i = 0; i < parts.length - 1; ) {
    const status = parts[i];
    if (status.startsWith('R')) {
      moved.set(parts[i + 1], parts[i + 2]);
      i += 3;
    } else {
      if (status === 'D') moved.set(parts[i + 1], null);
      i += 2;
    }
  }
  return moved;
}

/** Where each path touched at `sha` lives at `head`: a new path, or null when deleted. */
function pathsAtHead(sha, head) {
  const moved = moves(sha, head);
  return (p) => (moved.has(p) ? moved.get(p) : p);
}

function linesAt(head, p, cache) {
  const key = `${head}:${p}`;
  if (!cache.has(key)) {
    const r = spawnSync('git', ['show', key], { encoding: 'utf8', maxBuffer: 1 << 28 });
    cache.set(key, r.status !== 0 ? null : r.stdout.includes('\0') ? 'binary' : new Set(r.stdout.split('\n')));
  }
  return cache.get(key);
}

/** First later PR that removed `line` without re-adding it (null: deleted the file), tracking renames; `path` is the file's name on its side. */
function remover(later, startPath, line) {
  const names = new Set([startPath]);
  for (const pr of later) {
    for (const f of pr.files) {
      if (!names.has(f.from)) continue;
      if (f.deleted) return { pr, path: f.from };
      if (line !== null && f.removed.includes(line) && !f.added.includes(line)) return { pr, path: f.to };
      if (f.to) names.add(f.to);
    }
  }
  return null;
}

/**
 * Judge the commit on the remover's own branch that dropped a line (or, with `line` null, the file).
 * @returns {(pr: object, by: object|undefined, path: string, line: string|null) => boolean} true for a NOTE:
 *   an ordinary commit whose parent already held both the line and `pr`'s merge. Anything else is a finding:
 *   no remover, no second parent, the merge commit itself, a merge that dropped it, or a walk with no remover.
 */
function makeJudge(cache) {
  const parentsOf = new Map();
  const branches = new Map();
  const bases = new Map();
  const renamed = new Map();
  const parents = (c) => {
    if (!parentsOf.has(c)) parentsOf.set(c, git(['rev-list', '--parents', '-n', '1', c]).trim().split(' ').slice(1));
    return parentsOf.get(c);
  };
  const has = (c, p, line) => {
    const l = linesAt(c, p, cache);
    return line === null ? l !== null : l instanceof Set && l.has(line);
  };
  const mergeBase = (a, b) => {
    const key = `${a}:${b}`;
    if (!bases.has(key)) {
      const r = spawnSync('git', ['merge-base', a, b], { encoding: 'utf8' });
      bases.set(key, r.status === 0 ? r.stdout.trim() : null);
    }
    return bases.get(key);
  };
  const before = (par, c, p) => {
    const key = `${par}:${c}`;
    if (!renamed.has(key)) renamed.set(key, new Map([...moves(par, c)].filter(([, to]) => to).map(([from, to]) => [to, from])));
    return renamed.get(key).get(p) ?? p;
  };
  const branch = (p1, p2) => {
    const key = `${p1}:${p2}`;
    if (!branches.has(key)) {
      const rows = git(['rev-list', '--first-parent', '--parents', p2, `^${p1}`]).trim().split('\n').filter(Boolean);
      for (const row of rows) parentsOf.set(row.split(' ')[0], row.split(' ').slice(1));
      branches.set(key, rows.map((row) => row.split(' ')[0]));
    }
    return branches.get(key);
  };
  return (pr, by, path, line) => {
    if (!by) return false;
    const [p1, p2] = parents(by.sha);
    if (!p2 || has(p2, path, line)) return false;
    let p = path;
    for (const c of branch(p1, p2).slice(0, MAX_WALK)) {
      const [first, ...others] = parents(c);
      const q = line !== null && linesAt(first, p, cache) === null ? before(first, c, p) : p;
      if (has(first, q, line)) return others.length === 0 && isAncestor(pr.sha, first);
      for (const o of others) {
        if (!has(o, p, line)) continue;
        const b = mergeBase(first, o);
        if (!b || !has(b, p, line)) return false;
      }
      p = q;
    }
    return false;
  };
}

function check(args) {
  const head = resolve(args.head);
  const order = new Map(git(['rev-list', '--first-parent', head]).trim().split('\n').map((sha, i) => [sha, i]));
  const prs = args.prs.map((p) => {
    const sha = resolve(p.ref);
    if (!order.has(sha)) throw new Fail(`--pr ${p.label} (${sha}) is not a merge on --head's first-parent history`);
    return { ...p, sha, files: changes(`${sha}^1`, sha) };
  });
  prs.sort((a, b) => order.get(b.sha) - order.get(a.sha));
  const cache = new Map();
  const informed = makeJudge(cache);
  const findings = [];
  const notes = [];
  let checked = 0;
  prs.forEach((pr, i) => {
    const later = prs.slice(i + 1);
    const atHead = pathsAtHead(pr.sha, head);
    for (const f of pr.files) {
      if (!f.to || args.ignores.includes(f.to)) continue;
      const added = f.added.filter((l) => l.trim() !== '');
      if (!added.length) continue;
      const now = atHead(f.to);
      const lines = now === null ? null : linesAt(head, now, cache);
      if (lines === 'binary') continue;
      checked += added.length;
      if (lines === null) {
        const r = remover(later, f.to, null);
        (informed(pr, r?.pr, r?.path, null) ? notes : findings).push({ kind: 'DELETED', path: f.to, by: pr.label, count: added.length, removedBy: r?.pr.label });
        continue;
      }
      for (const line of added) {
        if (lines.has(line)) continue;
        const r = remover(later, f.to, line);
        (informed(pr, r?.pr, r?.path, line) ? notes : findings).push({ kind: 'OVERWRITE', path: now, by: pr.label, line, removedBy: r?.pr.label });
      }
    }
  });
  return { findings, notes, checked, prs: prs.length };
}

const quoted = (line) => JSON.stringify(line.length > 120 ? `${line.slice(0, 117)}...` : line);

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const f of items) {
    const key = keyOf(f);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return [...groups.values()];
}

function report({ findings, notes, checked, prs }) {
  for (const g of groupBy(notes, (f) => `${f.path}\0${f.removedBy}\0${f.by}`)) {
    const { path, removedBy, by } = g[0];
    const count = g.reduce((n, f) => n + (f.count ?? 1), 0);
    console.log(`NOTE: ${path}: ${removedBy} rewrote ${count} line(s) ${by} added, in a commit built on ${by}`);
  }
  const removal = (by) => (by ? `removed by ${by}` : "removed outside the run's PRs");
  for (const g of groupBy(findings, (f) => `${f.kind}\0${f.path}\0${f.by}\0${f.removedBy ?? ''}`)) {
    const { kind, path, by, removedBy } = g[0];
    if (kind === 'DELETED') {
      console.log(`DELETED: ${path}: ${by} added ${g[0].count} line(s); file ${removedBy ? `deleted by ${removedBy}` : "deleted outside the run's PRs"}`);
      continue;
    }
    for (const f of g.slice(0, SHOW_PER_GROUP)) console.log(`OVERWRITE: ${path}: ${by} added ${quoted(f.line)}; ${removal(removedBy)}`);
    if (g.length > SHOW_PER_GROUP) console.log(`OVERWRITE: ${path}: … and ${g.length - SHOW_PER_GROUP} more line(s) ${by} added; ${removal(removedBy)}`);
  }
  const lost = findings.reduce((n, f) => n + (f.count ?? 1), 0);
  const rewritten = notes.reduce((n, f) => n + (f.count ?? 1), 0);
  if (!findings.length) console.log(`overwrites: none (${checked} added line(s) across ${prs} PR(s); ${rewritten} rewritten by PRs built on them)`);
  else console.log(`overwrites: ${lost} of ${checked} added line(s) missing, in ${new Set(findings.map((f) => f.path)).size} file(s)`);
  return findings.length ? 1 : 0;
}

/**
 * The rebase replays only the branch's non-merge commits, so a line --onto holds that --after lacks was
 * dropped by a conflict resolution unless one of those commits removed it. Lines added since the fork are
 * findings even then (owner ruling, #752). Catch-up merges are not replayed, so a line one dropped counts.
 * @param {object} args `before`, `after`, `onto` and `ignores` from the command line
 */
function checkRebase(args) {
  const [before, after, onto] = [args.before, args.after, args.onto].map(resolve);
  if (!isAncestor(onto, after)) throw new Fail(`--after ${after} does not descend from --onto ${onto}`);
  const fork = git(['merge-base', before, onto]).trim();
  const atAfter = pathsAtHead(onto, after);
  const cache = new Map();
  const findings = [];
  let checked = 0;
  for (const f of changes(fork, onto)) {
    if (!f.to || args.ignores.includes(f.to)) continue;
    const added = f.added.filter((l) => l.trim() !== '');
    if (!added.length) continue;
    const now = atAfter(f.to);
    const lines = now === null ? null : linesAt(after, now, cache);
    if (lines === 'binary') continue;
    checked += added.length;
    if (lines === null) {
      findings.push({ kind: 'DELETED', path: f.to, count: added.length });
      continue;
    }
    for (const line of added) {
      if (!lines.has(line)) findings.push({ kind: 'REBASE', path: now, line });
    }
  }
  const seen = new Set(findings.map((f) => `${f.path}\0${f.line ?? ''}`));
  const ownRemovals = new Set();
  for (const c of git(['rev-list', '--no-merges', `${onto}..${before}`]).split('\n').filter(Boolean)) {
    const atAfterC = pathsAtHead(c, after);
    for (const f of changes(`${c}^`, c)) {
      const p = f.to ? (atAfterC(f.to) ?? f.to) : f.from;
      for (const l of f.removed) if (!f.added.includes(l)) ownRemovals.add(`${p}\0${l}`);
    }
  }
  for (const f of changes(onto, after)) {
    if (!f.from || args.ignores.includes(f.from) || args.ignores.includes(f.to)) continue;
    const kept = f.to ? linesAt(after, f.to, cache) : null;
    if (kept === 'binary') continue;
    const at = f.to ?? f.from;
    const key = (l) => (kept === null ? `${f.from}\0` : `${f.to}\0${l}`);
    const dropped = [...new Set(f.removed)].filter((l) => l.trim() !== '' && !kept?.has(l) && !seen.has(key(l)) && !ownRemovals.has(`${at}\0${l}`));
    if (!dropped.length) continue;
    checked += dropped.length;
    if (kept === null) findings.push({ kind: 'DELETED', path: f.from, count: dropped.length });
    else for (const line of dropped) findings.push({ kind: 'REBASE', path: f.to, line });
  }
  return { findings, checked, fork };
}

function reportRebase({ findings, checked, fork }) {
  for (const g of groupBy(findings, (f) => `${f.kind}\0${f.path}`)) {
    const { kind, path, count } = g[0];
    if (kind === 'DELETED') {
      console.log(`DELETED: ${path}: upstream added ${count} line(s); file dropped resolving the rebase`);
      continue;
    }
    for (const f of g.slice(0, SHOW_PER_GROUP)) console.log(`REBASE: ${path}: upstream added ${quoted(f.line)}; dropped resolving the rebase`);
    if (g.length > SHOW_PER_GROUP) console.log(`REBASE: ${path}: … and ${g.length - SHOW_PER_GROUP} more upstream line(s) dropped resolving the rebase`);
  }
  const lost = findings.reduce((n, f) => n + (f.count ?? 1), 0);
  if (!findings.length) console.log(`rebase: none dropped (${checked} line(s) upstream added since ${fork.slice(0, 7)})`);
  else console.log(`rebase: ${lost} of ${checked} upstream line(s) dropped, in ${new Set(findings.map((f) => f.path)).size} file(s)`);
  return findings.length ? 1 : 0;
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
  process.exit(args.rebase ? reportRebase(checkRebase(args)) : report(check(args)));
} catch (e) {
  console.error(`ERROR: ${e instanceof Fail ? e.message : e.stack}`);
  process.exit(2);
}
