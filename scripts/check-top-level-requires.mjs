/**
 * CI guard: ensure no top-level require() calls exist in source files.
 * Top-level require() for Node.js builtins causes crashes on Obsidian mobile
 * because esbuild marks them as external and the literal require() executes
 * at module load time — before any Platform.isDesktop guard can run.
 *
 * Usage: node scripts/check-top-level-requires.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

function collectTsFiles(dir) {
	let results = [];
	for (const entry of readdirSync(dir)) {
		const full = resolve(dir, entry);
		if (statSync(full).isDirectory()) {
			results = results.concat(collectTsFiles(full));
		} else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.d.ts')) {
			results.push(full);
		}
	}
	return results;
}

const files = collectTsFiles(resolve(root, 'src'));
const requireRe = /\brequire\s*\(/;
const violations = [];

for (const file of files) {
	const source = readFileSync(file, 'utf8');
	const lines = source.split('\n');
	let braceDepth = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Track brace depth (simplified — ignores braces in strings/comments,
		// but sufficient for well-formatted TypeScript)
		for (const ch of line) {
			if (ch === '{') braceDepth++;
			if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
		}

		if (braceDepth === 0 && requireRe.test(line)) {
			const rel = file.replace(root + '/', '');
			violations.push(`  ${rel}:${i + 1}: ${line.trim()}`);
		}
	}
}

if (violations.length > 0) {
	console.error('ERROR: Top-level require() calls detected:\n');
	for (const v of violations) {
		console.error(v);
	}
	console.error(
		'\nMove these into function/method bodies or use a lazy getter ' +
		'to avoid crashes on Obsidian mobile.'
	);
	process.exit(1);
} else {
	console.log('No top-level require() calls found.');
}
