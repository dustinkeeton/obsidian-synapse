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

function callsAI(text: string): boolean {
	return AI_CALL.test(text) || (AI_CLIENT_FILE.test(text) && ANY_CALL.test(text));
}

function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function countMatches(text: string, re: RegExp): number {
	return (text.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) ?? []).length;
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
		.filter(({ file, text }) => file !== 'shared/ai-client.ts' && callsAI(text));

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
			.map(({ file, text }) => ({ file, calls: countMatches(text, AI_CALL), fences: countMatches(text, /wrapUntrusted\(/) }))
			.filter(({ calls, fences }) => fences < calls);
		expect(underFenced).toEqual([]);
	});

	it('keeps the image-only allowlist current', () => {
		const callerFiles = new Set(callers.map(({ file }) => file));
		expect(Object.keys(IMAGE_ONLY).filter((file) => !callerFiles.has(file))).toEqual([]);
	});
});
