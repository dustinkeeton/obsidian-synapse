import { describe, it, expect } from 'vitest';
import { redactSecrets } from './redact';

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
