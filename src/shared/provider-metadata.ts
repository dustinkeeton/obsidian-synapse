// Per-provider credential metadata: the "get a key" console URL, the input
// placeholder + format hint, and the minimal authenticated probe used to verify
// a key live (#335). This is pure data with no Obsidian runtime import so the
// validator and its tests can consume it without rendering UI.
//
// The probe URLs/headers below are copied verbatim from the real request call
// sites (src/shared/ai-client.ts, src/audio/transcriber.ts) so a "Test" click
// exercises exactly the auth path the feature itself will use.

import type { AIProvider } from '../settings';

/**
 * The set of providers whose credentials Synapse can validate.
 *
 * Deliberately distinct from the two existing provider unions:
 *  - `AIProvider` ('openai' | 'anthropic' | 'gemini' | 'ollama') has no Deepgram.
 *  - `audio.transcriptionProvider` ('whisper-api' | 'deepgram' | 'gemini' |
 *    'local-whisper') — `whisper-api` authenticates with an OpenAI key, so it
 *    maps onto `openai` here; `local-whisper` needs no credential.
 */
export type CredentialProvider = 'openai' | 'anthropic' | 'gemini' | 'deepgram' | 'ollama';

/** A minimal, read-only authenticated probe used to verify a credential. */
export interface ProbeSpec {
	method: 'GET';
	url: string;
	headers: Record<string, string>;
}

export interface ProviderMetadata {
	/** Human label for the status chip, e.g. "OpenAI" → "Connected to OpenAI". */
	label: string;
	/** Console "get a key" URL for the deep link. Empty for keyless providers. */
	getKeyUrl: string;
	/** Field `<input>` placeholder, e.g. `sk-...`. */
	placeholder: string;
	/** One-line format help shown as a neutral hint beneath the field. */
	formatHint: string;
	/** False only for keyless providers — Ollama authenticates by reachability. */
	requiresKey: boolean;
	/**
	 * Build the validation probe for this provider, or `null` to short-circuit
	 * WITHOUT firing a request:
	 *  - keyed providers: when `key` is empty/blank.
	 *  - ollama: when `endpoint` is missing, unparseable, or insecure (plain
	 *    `http:` for a non-localhost host), mirroring the guard in ai-client.ts.
	 */
	buildProbe(input: { key: string; endpoint?: string }): ProbeSpec | null;
}

/**
 * Validate an Ollama endpoint, returning the parsed URL or `null`. Allows
 * `http:` only for localhost; everything else must be `https:`. Mirrors the
 * guard in {@link callOllama} (src/shared/ai-client.ts) so the probe and the
 * real request agree on what counts as a usable endpoint.
 */
function parseOllamaEndpoint(endpoint: string): URL | null {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return null;
	}
	const isLocalhost =
		url.hostname === 'localhost' ||
		url.hostname === '127.0.0.1' ||
		url.hostname === '::1' ||
		url.hostname === '[::1]';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
		return null;
	}
	return url;
}

export const PROVIDER_METADATA: Record<CredentialProvider, ProviderMetadata> = {
	openai: {
		label: 'OpenAI',
		getKeyUrl: 'https://platform.openai.com/api-keys',
		placeholder: 'sk-...',
		formatHint: 'OpenAI keys start with “sk-”.',
		requiresKey: true,
		buildProbe: ({ key }) =>
			key.trim() === ''
				? null
				: {
						method: 'GET',
						url: 'https://api.openai.com/v1/models',
						headers: { Authorization: `Bearer ${key.trim()}` },
					},
	},
	anthropic: {
		label: 'Anthropic',
		getKeyUrl: 'https://console.anthropic.com/settings/keys',
		placeholder: 'sk-ant-...',
		formatHint: 'Anthropic keys start with “sk-ant-”.',
		requiresKey: true,
		buildProbe: ({ key }) =>
			key.trim() === ''
				? null
				: {
						method: 'GET',
						url: 'https://api.anthropic.com/v1/models',
						headers: {
							'x-api-key': key.trim(),
							'anthropic-version': '2023-06-01',
						},
					},
	},
	gemini: {
		label: 'Google Gemini',
		getKeyUrl: 'https://aistudio.google.com/apikey',
		placeholder: 'AIza...',
		formatHint: 'Google AI Studio keys start with “AIza”.',
		requiresKey: true,
		buildProbe: ({ key }) =>
			key.trim() === ''
				? null
				: {
						method: 'GET',
						url: 'https://generativelanguage.googleapis.com/v1beta/models',
						headers: { 'x-goog-api-key': key.trim() },
					},
	},
	deepgram: {
		label: 'Deepgram',
		getKeyUrl: 'https://console.deepgram.com',
		placeholder: 'Deepgram API key',
		formatHint: 'Paste the API key from your Deepgram console.',
		requiresKey: true,
		buildProbe: ({ key }) =>
			key.trim() === ''
				? null
				: {
						method: 'GET',
						url: 'https://api.deepgram.com/v1/projects',
						headers: { Authorization: `Token ${key.trim()}` },
					},
	},
	ollama: {
		label: 'Ollama',
		getKeyUrl: '',
		placeholder: 'http://localhost:11434',
		formatHint: 'Local server URL; HTTPS is required for non-localhost hosts.',
		requiresKey: false,
		buildProbe: ({ endpoint }) => {
			if (!endpoint || parseOllamaEndpoint(endpoint) === null) {
				return null;
			}
			return {
				method: 'GET',
				url: `${endpoint.replace(/\/+$/, '')}/api/tags`,
				headers: {},
			};
		},
	},
};

/**
 * Map the AI-provider dropdown value to its credential provider. AIProvider is a
 * subset of {@link CredentialProvider} (it has no Deepgram), so this is an
 * identity narrowing — provided as a function so call sites read intentionally
 * and stay correct if the unions diverge further.
 */
export function aiProviderToCredential(provider: AIProvider): CredentialProvider {
	return provider;
}
