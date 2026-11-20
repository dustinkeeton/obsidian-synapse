import { describe, it, expect } from 'vitest';
import { SAMPLING_MAX_TOKENS, toGenerationOutput, toSamplingParams } from './sampling.js';

describe('toSamplingParams (#628)', () => {
	it('moves system messages to the system prompt and splits multi-block messages', () => {
		const params = toSamplingParams({
			id: 'r1',
			feature: 'elaboration',
			messages: [
				{ role: 'system', content: 'Policy' },
				{ role: 'system', content: [{ type: 'text', text: 'Voice' }] },
				{ role: 'user', content: [{ type: 'text', text: 'Look:' }, { type: 'image', data: 'AAAA', mediaType: 'image/png' }] },
				{ role: 'assistant', content: 'Earlier' },
				{ role: 'user', content: 'Go on' },
			],
		});
		expect(params).toEqual({
			systemPrompt: 'Policy\n\nVoice',
			maxTokens: SAMPLING_MAX_TOKENS,
			includeContext: 'none',
			messages: [
				{ role: 'user', content: { type: 'text', text: 'Look:' } },
				{ role: 'user', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } },
				{ role: 'assistant', content: { type: 'text', text: 'Earlier' } },
				{ role: 'user', content: { type: 'text', text: 'Go on' } },
			],
		});
	});
});

describe('toGenerationOutput (#628)', () => {
	it('keeps model and stop reason, and marks a maxTokens stop as truncated', () => {
		expect(toGenerationOutput('r1', { role: 'assistant', model: 'm', stopReason: 'endTurn', content: { type: 'text', text: 'Body' } }))
			.toEqual({ requestId: 'r1', text: 'Body', model: 'm', stopReason: 'endTurn' });
		expect(toGenerationOutput('r2', { role: 'assistant', model: 'm', stopReason: 'maxTokens', content: { type: 'text', text: 'Cut' } }))
			.toMatchObject({ truncated: true });
	});
});
