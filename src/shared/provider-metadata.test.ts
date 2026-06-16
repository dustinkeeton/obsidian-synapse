import { describe, it, expect } from 'vitest';
import { PROVIDER_METADATA, aiProviderToCredential } from './provider-metadata';
import type { CredentialProvider } from './provider-metadata';

const KEYED: CredentialProvider[] = ['openai', 'anthropic', 'gemini', 'deepgram'];
const ALL: CredentialProvider[] = [...KEYED, 'ollama'];

describe('PROVIDER_METADATA', () => {
	it.each(ALL)('%s has a label, placeholder, and format hint', (provider) => {
		const meta = PROVIDER_METADATA[provider];
		expect(meta.label).toBeTruthy();
		expect(meta.placeholder).toBeTruthy();
		expect(meta.formatHint).toBeTruthy();
	});

	it.each(KEYED)('%s exposes a valid https get-key URL', (provider) => {
		const url = new URL(PROVIDER_METADATA[provider].getKeyUrl);
		expect(url.protocol).toBe('https:');
	});

	it('marks only ollama as keyless (no key, no get-key URL)', () => {
		expect(PROVIDER_METADATA.ollama.requiresKey).toBe(false);
		expect(PROVIDER_METADATA.ollama.getKeyUrl).toBe('');
		for (const p of KEYED) {
			expect(PROVIDER_METADATA[p].requiresKey).toBe(true);
		}
	});

	describe('buildProbe — keyed providers', () => {
		it('returns null for an empty or blank key', () => {
			for (const p of KEYED) {
				expect(PROVIDER_METADATA[p].buildProbe({ key: '' })).toBeNull();
				expect(PROVIDER_METADATA[p].buildProbe({ key: '   ' })).toBeNull();
			}
		});

		it('builds the OpenAI probe (Bearer → /v1/models)', () => {
			expect(PROVIDER_METADATA.openai.buildProbe({ key: 'sk-test' })).toEqual({
				method: 'GET',
				url: 'https://api.openai.com/v1/models',
				headers: { Authorization: 'Bearer sk-test' },
			});
		});

		it('builds the Anthropic probe (x-api-key + version → /v1/models)', () => {
			expect(PROVIDER_METADATA.anthropic.buildProbe({ key: 'sk-ant-test' })).toEqual({
				method: 'GET',
				url: 'https://api.anthropic.com/v1/models',
				headers: { 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01' },
			});
		});

		it('builds the Gemini probe (x-goog-api-key → /v1beta/models)', () => {
			expect(PROVIDER_METADATA.gemini.buildProbe({ key: 'AIzaTest' })).toEqual({
				method: 'GET',
				url: 'https://generativelanguage.googleapis.com/v1beta/models',
				headers: { 'x-goog-api-key': 'AIzaTest' },
			});
		});

		it('builds the Deepgram probe (Token → /v1/projects)', () => {
			expect(PROVIDER_METADATA.deepgram.buildProbe({ key: 'dgkey' })).toEqual({
				method: 'GET',
				url: 'https://api.deepgram.com/v1/projects',
				headers: { Authorization: 'Token dgkey' },
			});
		});

		it('trims surrounding whitespace from the key', () => {
			const probe = PROVIDER_METADATA.openai.buildProbe({ key: '  sk-test  ' });
			expect(probe?.headers.Authorization).toBe('Bearer sk-test');
		});
	});

	describe('buildProbe — ollama (keyless, reachability)', () => {
		it('targets {endpoint}/api/tags with no auth header for a localhost endpoint', () => {
			expect(
				PROVIDER_METADATA.ollama.buildProbe({ key: '', endpoint: 'http://localhost:11434' }),
			).toEqual({
				method: 'GET',
				url: 'http://localhost:11434/api/tags',
				headers: {},
			});
		});

		it('strips a trailing slash from the endpoint', () => {
			const probe = PROVIDER_METADATA.ollama.buildProbe({
				key: '',
				endpoint: 'http://localhost:11434/',
			});
			expect(probe?.url).toBe('http://localhost:11434/api/tags');
		});

		it('allows https for a remote host', () => {
			const probe = PROVIDER_METADATA.ollama.buildProbe({
				key: '',
				endpoint: 'https://ollama.example.com',
			});
			expect(probe?.url).toBe('https://ollama.example.com/api/tags');
		});

		it('returns null for plain http on a non-localhost host', () => {
			expect(
				PROVIDER_METADATA.ollama.buildProbe({ key: '', endpoint: 'http://ollama.example.com' }),
			).toBeNull();
		});

		it('returns null for a missing or unparseable endpoint', () => {
			expect(PROVIDER_METADATA.ollama.buildProbe({ key: '' })).toBeNull();
			expect(PROVIDER_METADATA.ollama.buildProbe({ key: '', endpoint: 'not a url' })).toBeNull();
		});
	});
});

describe('aiProviderToCredential', () => {
	it.each([
		['openai', 'openai'],
		['anthropic', 'anthropic'],
		['gemini', 'gemini'],
		['ollama', 'ollama'],
	] as const)('maps AI provider %s → credential %s', (ai, cred) => {
		expect(aiProviderToCredential(ai)).toBe(cred);
	});
});
