import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestUrl } from '../__mocks__/obsidian';
import { validateCredentials } from './credential-validator';

const mockRequestUrl = vi.mocked(requestUrl);

function ok(json: unknown = {}) {
	return { status: 200, json, text: '', headers: {} };
}
function resp(status: number, json: unknown = {}, text = '') {
	return { status, json, text, headers: {} };
}

describe('validateCredentials', () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('successful probes', () => {
		it('returns valid and hits the OpenAI models endpoint with a Bearer header (throw:false)', async () => {
			mockRequestUrl.mockResolvedValue(ok({ data: [] }));

			const result = await validateCredentials('openai', 'sk-test');

			expect(result.status).toBe('valid');
			expect(result.message).toContain('OpenAI');
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
			const call = mockRequestUrl.mock.calls[0][0] as any;
			expect(call.url).toBe('https://api.openai.com/v1/models');
			expect(call.method).toBe('GET');
			expect(call.headers.Authorization).toBe('Bearer sk-test');
			expect(call.throw).toBe(false);
		});

		it('sends the Anthropic x-api-key + version headers', async () => {
			mockRequestUrl.mockResolvedValue(ok());
			await validateCredentials('anthropic', 'sk-ant-test');
			const call = mockRequestUrl.mock.calls[0][0] as any;
			expect(call.url).toBe('https://api.anthropic.com/v1/models');
			expect(call.headers['x-api-key']).toBe('sk-ant-test');
			expect(call.headers['anthropic-version']).toBe('2023-06-01');
		});

		it('sends the Gemini x-goog-api-key header', async () => {
			mockRequestUrl.mockResolvedValue(ok());
			await validateCredentials('gemini', 'AIzaTest');
			const call = mockRequestUrl.mock.calls[0][0] as any;
			expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
			expect(call.headers['x-goog-api-key']).toBe('AIzaTest');
		});

		it('sends the Deepgram Token header', async () => {
			mockRequestUrl.mockResolvedValue(ok());
			await validateCredentials('deepgram', 'dgkey');
			const call = mockRequestUrl.mock.calls[0][0] as any;
			expect(call.url).toBe('https://api.deepgram.com/v1/projects');
			expect(call.headers.Authorization).toBe('Token dgkey');
		});

		it('reports reachability (not "connected") for a keyless ollama probe', async () => {
			mockRequestUrl.mockResolvedValue(ok({ models: [] }));
			const result = await validateCredentials('ollama', '', {
				endpoint: 'http://localhost:11434',
			});
			expect(result.status).toBe('valid');
			expect(result.message.toLowerCase()).toContain('reachable');
			const call = mockRequestUrl.mock.calls[0][0] as any;
			expect(call.url).toBe('http://localhost:11434/api/tags');
		});
	});

	describe('invalid keys', () => {
		it.each([401, 403])('maps HTTP %i to invalid', async (status) => {
			mockRequestUrl.mockResolvedValue(resp(status, { error: { message: 'unauthorized' } }));
			const result = await validateCredentials('openai', 'sk-bad');
			expect(result.status).toBe('invalid');
			expect(result.message).toContain('Invalid key');
		});

		it('redacts a key echoed back in the error body', async () => {
			const leaked = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
			mockRequestUrl.mockResolvedValue(
				resp(400, { error: { message: `API key not valid: ${leaked}` } }),
			);
			const result = await validateCredentials('gemini', leaked);
			expect(result.message).toContain('[REDACTED]');
			expect(result.message).not.toContain(leaked);
		});
	});

	describe('other failures', () => {
		it('maps 429 to error (not invalid) and mentions rate limiting', async () => {
			mockRequestUrl.mockResolvedValue(resp(429));
			const result = await validateCredentials('openai', 'sk-x');
			expect(result.status).toBe('error');
			expect(result.message.toLowerCase()).toContain('rate limit');
		});

		it('maps 500 to error and includes the status + detail', async () => {
			mockRequestUrl.mockResolvedValue(resp(500, {}, 'upstream boom'));
			const result = await validateCredentials('openai', 'sk-x');
			expect(result.status).toBe('error');
			expect(result.message).toContain('500');
			expect(result.message).toContain('upstream boom');
		});

		it('maps a rejected request to a network error message', async () => {
			mockRequestUrl.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));
			const result = await validateCredentials('openai', 'sk-x');
			expect(result.status).toBe('error');
			expect(result.message.toLowerCase()).toContain('connect');
		});

		it('times out fast and reports a timeout', async () => {
			// requestUrl never resolves → the timeout race wins.
			mockRequestUrl.mockReturnValue(new Promise<never>(() => {}));
			const result = await validateCredentials('openai', 'sk-x', { timeoutMs: 5 });
			expect(result.status).toBe('error');
			expect(result.message.toLowerCase()).toContain('timed out');
		});
	});

	describe('skipped (no request made)', () => {
		it('skips keyed providers with an empty/blank key', async () => {
			const result = await validateCredentials('openai', '   ');
			expect(result.status).toBe('skipped');
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it('skips ollama with an insecure non-localhost endpoint', async () => {
			const result = await validateCredentials('ollama', '', {
				endpoint: 'http://evil.example.com',
			});
			expect(result.status).toBe('skipped');
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});
	});

	describe('one-shot (no retry)', () => {
		it('fires exactly one request for a 401', async () => {
			mockRequestUrl.mockResolvedValue(resp(401));
			await validateCredentials('openai', 'sk-bad');
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});
	});
});
