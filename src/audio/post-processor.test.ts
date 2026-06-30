import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { PostProcessor } from './post-processor';
import { AIClient } from '../shared';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	mutate?.(s);
	return s;
}

describe('PostProcessor', () => {
	let completeSpy: MockInstance<typeof AIClient.prototype.complete>;

	beforeEach(() => {
		completeSpy = vi.spyOn(AIClient.prototype, 'complete').mockResolvedValue('processed');
	});

	afterEach(() => vi.restoreAllMocks());

	it('returns the raw transcript untouched when post-processing is disabled', async () => {
		const settings = makeSettings((s) => {
			s.audio.postProcessing.enabled = false;
		});
		const pp = new PostProcessor(() => settings);

		const result = await pp.process('um raw text');
		expect(result).toBe('um raw text');
		expect(completeSpy).not.toHaveBeenCalled();
	});

	it('returns the raw transcript when enabled but no instructions are active', async () => {
		const settings = makeSettings((s) => {
			s.audio.postProcessing.enabled = true;
			s.audio.postProcessing.removeFiller = false;
			s.audio.postProcessing.addStructure = false;
			s.audio.postProcessing.extractKeyPoints = false;
			s.audio.postProcessing.customPrompt = '';
		});
		const pp = new PostProcessor(() => settings);

		const result = await pp.process('raw');
		expect(result).toBe('raw');
		expect(completeSpy).not.toHaveBeenCalled();
	});

	it('builds an instruction list from the enabled toggles and sends it to the AI', async () => {
		const settings = makeSettings((s) => {
			s.audio.postProcessing.enabled = true;
			s.audio.postProcessing.removeFiller = true;
			s.audio.postProcessing.addStructure = true;
			s.audio.postProcessing.extractKeyPoints = true;
			s.audio.postProcessing.customPrompt = 'Use British spelling';
		});
		const pp = new PostProcessor(() => settings);

		await pp.process('the transcript');

		expect(completeSpy).toHaveBeenCalledTimes(1);
		const [prompt, systemPrompt] = completeSpy.mock.calls[0];
		expect(prompt).toContain('Remove filler words');
		expect(prompt).toContain('Add proper punctuation');
		expect(prompt).toContain('Key Points');
		expect(prompt).toContain('Use British spelling');
		expect(prompt).toContain('the transcript');
		expect(systemPrompt).toContain('transcription editor');
	});

	it('sanitizes the AI response before returning it', async () => {
		completeSpy.mockResolvedValue('clean text<script>alert(1)</script> here');
		const settings = makeSettings((s) => {
			s.audio.postProcessing.enabled = true;
			s.audio.postProcessing.removeFiller = true;
		});
		const pp = new PostProcessor(() => settings);

		const result = await pp.process('raw');
		// sanitizeAIResponse strips injected <script> content
		expect(result).toBe('clean text here');
		expect(result).not.toContain('<script>');
	});
});
