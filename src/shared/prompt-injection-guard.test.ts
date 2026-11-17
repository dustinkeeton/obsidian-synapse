import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..');

// Sends only an image plus a fixed instruction; AIClient adds the policy to the system prompt.
const IMAGE_ONLY: Record<string, string> = {
	'image/extractor.ts': 'OCR: image block + fixed instruction',
	'elaboration/image-analyzer.ts': 'image analysis: image block + fixed instruction',
};

const AI_CALL = /\b\w*(?:ai|client|llm|model)\w*\s*\.\s*(?:complete|chat)\s*\(/i;
const AI_CLIENT_FILE = /\bAIClient\b/;
const ANY_CALL = /(?<!checkpointManager)\s*\.\s*(?:complete|chat)\s*\(/;

function countMatches(text: string, re: RegExp): number {
	return (text.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) ?? []).length;
}

/** The same enumeration drives discovery and counting: any call shape in an `AIClient` file, else ai/client/llm/model receivers. */
function countAICalls(text: string): number {
	const named = countMatches(text, AI_CALL);
	return AI_CLIENT_FILE.test(text) ? Math.max(named, countMatches(text, ANY_CALL)) : named;
}

function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name.startsWith('__') ? [] : sourceFiles(path);
		return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
	});
}

describe('prompt-injection guard', () => {
	const callers = sourceFiles(SRC)
		.map((path) => ({ file: relative(SRC, path), text: stripComments(readFileSync(path, 'utf8')) }))
		.filter(({ file, text }) => file !== 'shared/ai-client.ts' && countAICalls(text) > 0);

	it('finds the AI call sites it guards', () => {
		expect(callers.length).toBeGreaterThan(10);
	});

	it('every file that sends text to the AI fences it with wrapUntrusted', () => {
		const unfenced = callers
			.filter(({ file, text }) => !(file in IMAGE_ONLY) && !text.includes('wrapUntrusted('))
			.map(({ file }) => file);
		expect(unfenced).toEqual([]);
	});

	it('fences at least once per AI call in each file', () => {
		const underFenced = callers
			.filter(({ file }) => !(file in IMAGE_ONLY))
			.map(({ file, text }) => ({ file, calls: countAICalls(text), fences: countMatches(text, /wrapUntrusted\(/) }))
			.filter(({ calls, fences }) => fences < calls);
		expect(underFenced).toEqual([]);
	});

	it('keeps the image-only allowlist current', () => {
		const callerFiles = new Set(callers.map(({ file }) => file));
		expect(Object.keys(IMAGE_ONLY).filter((file) => !callerFiles.has(file))).toEqual([]);
	});
});
