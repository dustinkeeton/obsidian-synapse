import { describe, it, expect } from 'vitest';
import { titleContentKey } from './content-key';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';

function settings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	mutate?.(s);
	return s;
}

const PATH = 'Inbox/Untitled.md';
const CONTENT = '# Neural networks\n\nA primer on backprop.';

describe('titleContentKey', () => {
	it('is deterministic for identical inputs', () => {
		const a = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings());
		const b = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings());
		expect(a).toBe(b);
	});

	it('changes when the note content changes', () => {
		const a = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings());
		const b = titleContentKey(PATH, CONTENT + ' edit', 'Untitled', 'untitled', settings());
		expect(a).not.toBe(b);
	});

	it('changes when the current title changes', () => {
		const a = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings());
		const b = titleContentKey(PATH, CONTENT, 'Untitled 1', 'untitled', settings());
		expect(a).not.toBe(b);
	});

	it('changes when the trigger changes', () => {
		const a = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings());
		const b = titleContentKey(PATH, CONTENT, 'Untitled', 'content-mismatch', settings());
		expect(a).not.toBe(b);
	});

	it('changes when the note path changes', () => {
		const a = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings());
		const b = titleContentKey('Other/Untitled.md', CONTENT, 'Untitled', 'untitled', settings());
		expect(a).not.toBe(b);
	});

	it('changes when AI provider/model/effort change', () => {
		const base = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings());

		const provider = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings((s) => { s.ai.provider = 'gemini'; }));
		const model = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings((s) => { s.ai.model = 'different-model'; }));
		const effort = titleContentKey(PATH, CONTENT, 'Untitled', 'untitled', settings((s) => { s.ai.model = 'opus'; s.ai.effort = 'high'; }));

		expect(new Set([base, provider, model, effort]).size).toBe(4);
	});
});
