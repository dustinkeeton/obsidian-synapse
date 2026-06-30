import { describe, it, expect } from 'vitest';
import { redactSecrets, redactError } from './redact';

describe('redactSecrets', () => {
	it('redacts Google AIza… keys (the gap an old inline regex once missed)', () => {
		const out = redactSecrets('API key not valid: AIzaSyBadKey1234567890123456789012345');
		expect(out).toContain('[REDACTED]');
		expect(out).not.toContain('AIzaSyBadKey');
	});

	it('redacts OpenAI sk- keys and Bearer tokens', () => {
		const out = redactSecrets('rejected key sk-abcdef1234567890 via Bearer abcdefgh12345678');
		expect(out).not.toContain('sk-abcdef1234567890');
		expect(out).not.toContain('abcdefgh12345678');
		expect(out).toContain('[REDACTED]');
	});

	it.each([
		['Deepgram dg-', 'token dg-abcdef1234567890'],
		['generic key-', 'value key-abcdef1234567890'],
		['anthropic-', 'id anthropic-abcdef1234567890'],
		['Token header', 'auth Token abcdefgh12345678'],
	])('redacts %s secrets', (_label, input) => {
		expect(redactSecrets(input)).toContain('[REDACTED]');
	});

	it('leaves non-secret error text intact', () => {
		const text = 'Unexpected token at position 12';
		expect(redactSecrets(text)).toBe(text);
	});

	it('redacts every secret when several appear in one string', () => {
		const out = redactSecrets('sk-abcdef1234567890 and AIzaSyBadKey1234567890123456789012345');
		expect(out).not.toContain('sk-abcdef1234567890');
		expect(out).not.toContain('AIzaSyBadKey');
		expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
	});
});

describe('redactError', () => {
	it('redacts a secret in an Error message (console.error(label, err) sink safety)', () => {
		const out = redactError(new Error('API error (401): invalid key sk-abcdef1234567890'));
		expect(out).not.toContain('sk-abcdef1234567890');
		expect(out).toContain('[REDACTED]');
	});

	it('redacts a secret embedded in an Error stack', () => {
		const err = new Error('boom');
		// A secret can ride along in a manually-set stack; the stack is what a raw
		// `console.error(label, err)` would print, so it must be scrubbed too.
		err.stack = 'Error: leaked Bearer abcdefgh12345678\n    at foo (bar.ts:1:1)';
		const out = redactError(err);
		expect(out).not.toContain('abcdefgh12345678');
		expect(out).toContain('[REDACTED]');
	});

	it('preserves non-secret error detail (still useful for debugging)', () => {
		const out = redactError(new Error('Unexpected token at position 12'));
		expect(out).toContain('Unexpected token at position 12');
		expect(out).not.toContain('[REDACTED]');
	});

	it('redacts a secret in a non-Error thrown value', () => {
		expect(redactError('raw string with sk-abcdef1234567890')).toContain('[REDACTED]');
		expect(redactError('raw string with sk-abcdef1234567890')).not.toContain('sk-abcdef1234567890');
	});

	it('handles non-Error, non-string values without throwing', () => {
		expect(redactError(42)).toBe('42');
		expect(redactError(null)).toBe('null');
		expect(redactError(undefined)).toBe('undefined');
	});
});
