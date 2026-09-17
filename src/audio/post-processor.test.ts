import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { PostProcessor } from './post-processor';
import { AIClient } from '../shared';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	mutate?.(s);
	return s;
}

// maxTokens 100 → whole-transcript budget 400 chars, section budget 240 chars, overlap 24 chars.
function longSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	return makeSettings((s) => {
		s.ai.maxTokens = 100;
		s.audio.postProcessing.enabled = true;
		s.audio.postProcessing.addStructure = true;
		s.audio.postProcessing.extractKeyPoints = false;
		mutate?.(s);
	});
}

function paragraph(tail: string): string {
	return 'x'.repeat(200) + ` tail ${tail}.`;
}

function sectionBody(prompt: string): string {
	return prompt.slice(prompt.indexOf('Transcript section:\n') + 'Transcript section:\n'.length);
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

	it.each(['', '   ', '\n\t', '[Music]', 'Thank you.'])(
		'makes no AI call and returns the input for transcript %j (#524)',
		async (raw) => {
			const pp = new PostProcessor(() => longSettings((s) => {
				s.audio.postProcessing.extractKeyPoints = true;
			}), { delayMs: 0 });

			const result = await pp.process(raw);

			expect(result).toBe(raw);
			expect(completeSpy).not.toHaveBeenCalled();
		}
	);

	it('post-processes a transcript that fits the output-token budget in a single call', async () => {
		const update = vi.fn();
		const notify = vi.fn();
		const pp = new PostProcessor(() => longSettings(), { notify, delayMs: 0 });

		const result = await pp.process('short transcript', { update });

		expect(result).toBe('processed');
		expect(completeSpy).toHaveBeenCalledTimes(1);
		expect(completeSpy.mock.calls[0][0]).not.toContain('Transcript section');
		expect(update).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
	});

	it('propagates a failure of the single-call path', async () => {
		completeSpy.mockRejectedValue(new Error('no AI key'));
		const pp = new PostProcessor(() => longSettings());

		await expect(pp.process('short transcript')).rejects.toThrow('no AI key');
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

		const result = await pp.process('raw transcript text');
		expect(result).toBe('clean text here');
		expect(result).not.toContain('<script>');
	});

	describe('long transcripts (#467)', () => {
		it('splits a transcript over the budget into sections at paragraph boundaries', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const paragraphs = ['one', 'two', 'three', 'four', 'five'].map(paragraph);
			completeSpy.mockImplementation(async () => `section ${completeSpy.mock.calls.length}`);
			const pp = new PostProcessor(() => longSettings(), { delayMs: 0 });

			const result = await pp.process(paragraphs.join('\n\n'));

			expect(completeSpy).toHaveBeenCalledTimes(5);
			completeSpy.mock.calls.forEach(([prompt], i) => {
				expect(sectionBody(prompt).trim()).toBe(paragraphs[i]);
			});
			expect(result).toBe('section 1\n\nsection 2\n\nsection 3\n\nsection 4\n\nsection 5');
			expect(warn).not.toHaveBeenCalled();
		});

		it('sends the previous section tail as context and trims a verbatim repeat from the output', async () => {
			completeSpy
				.mockResolvedValueOnce('Clean one.')
				.mockResolvedValueOnce('tail one. Clean two.');
			const pp = new PostProcessor(() => longSettings(), { delayMs: 0 });

			const result = await pp.process([paragraph('one'), paragraph('two')].join('\n\n'));

			const [first, second] = completeSpy.mock.calls.map(([prompt]) => prompt);
			expect(first).not.toContain('Preceding context:');
			expect(second).toContain('Preceding context:\ntail one.');
			expect(sectionBody(second)).not.toContain('tail one.');
			expect(result).toBe('Clean one.\n\nClean two.');
		});

		it('keeps the raw slice when a section fails and still runs the remaining sections', async () => {
			vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			completeSpy
				.mockResolvedValueOnce('Clean one.')
				.mockRejectedValueOnce(new Error('timeout'))
				.mockResolvedValueOnce('Clean three.');
			const notify = vi.fn();
			const pp = new PostProcessor(() => longSettings(), { notify, delayMs: 0 });
			const paragraphs = [paragraph('one'), paragraph('two'), paragraph('three')];

			const result = await pp.process(paragraphs.join('\n\n'));

			expect(completeSpy).toHaveBeenCalledTimes(3);
			expect(result).toBe(`Clean one.\n\n${paragraphs[1]}\n\nClean three.`);
			expect(notify).toHaveBeenCalledTimes(1);
			expect(notify).toHaveBeenCalledWith('Post-processing kept 1 of 3 sections raw');
		});

		it('keeps the raw slice for an empty reply or one that hit the token cap', async () => {
			completeSpy
				.mockResolvedValueOnce('Clean one.')
				.mockResolvedValueOnce('   ')
				.mockResolvedValueOnce('y'.repeat(400));
			const notify = vi.fn();
			const pp = new PostProcessor(() => longSettings(), { notify, delayMs: 0 });
			const paragraphs = [paragraph('one'), paragraph('two'), paragraph('three')];

			const result = await pp.process(paragraphs.join('\n\n'));

			expect(result).toBe(`Clean one.\n\n${paragraphs[1]}\n\n${paragraphs[2]}`);
			expect(notify).toHaveBeenCalledWith('Post-processing kept 2 of 3 sections raw');
		});

		it('does not notify when every section succeeds', async () => {
			const notify = vi.fn();
			const pp = new PostProcessor(() => longSettings(), { notify, delayMs: 0 });

			await pp.process([paragraph('one'), paragraph('two')].join('\n\n'));

			expect(notify).not.toHaveBeenCalled();
		});

		it('reports progress for each section in order', async () => {
			const update = vi.fn<(message: string) => void>();
			const pp = new PostProcessor(() => longSettings(), { delayMs: 0 });

			await pp.process([paragraph('one'), paragraph('two'), paragraph('three')].join('\n\n'), { update });

			expect(update.mock.calls.map(([m]) => m)).toEqual([
				'Post-processing (1/3)',
				'Post-processing (2/3)',
				'Post-processing (3/3)',
			]);
		});

		it('keeps every section within the output budget', async () => {
			const pp = new PostProcessor(() => longSettings(), { delayMs: 0 });

			await pp.process('word '.repeat(300));

			expect(completeSpy).toHaveBeenCalledTimes(7);
			for (const [prompt] of completeSpy.mock.calls) {
				const body = sectionBody(prompt);
				expect(body.length).toBeGreaterThan(0);
				expect(body.length).toBeLessThanOrEqual(240);
			}
		});

		it('adds key points once at the end instead of once per section', async () => {
			completeSpy
				.mockResolvedValueOnce('Clean one.')
				.mockResolvedValueOnce('Clean two.')
				.mockResolvedValueOnce('## Key Points\n- a point');
			const update = vi.fn();
			const settings = longSettings((s) => {
				s.audio.postProcessing.extractKeyPoints = true;
			});
			const pp = new PostProcessor(() => settings, { delayMs: 0 });

			const result = await pp.process([paragraph('one'), paragraph('two')].join('\n\n'), { update });

			expect(completeSpy).toHaveBeenCalledTimes(3);
			const prompts = completeSpy.mock.calls.map(([p]) => p);
			expect(prompts[0]).not.toContain('Key Points');
			expect(prompts[1]).not.toContain('Key Points');
			expect(prompts[2]).toContain('Key Points');
			expect(prompts[2]).toContain('Clean one.\n\nClean two.');
			expect(result).toBe('Clean one.\n\nClean two.\n\n## Key Points\n- a point');
			expect(update).toHaveBeenLastCalledWith('Post-processing (3/3)');
		});

		it('drops the key points pass silently when it fails', async () => {
			vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			completeSpy
				.mockResolvedValueOnce('Clean one.')
				.mockResolvedValueOnce('Clean two.')
				.mockRejectedValueOnce(new Error('timeout'));
			const notify = vi.fn();
			const settings = longSettings((s) => {
				s.audio.postProcessing.extractKeyPoints = true;
			});
			const pp = new PostProcessor(() => settings, { notify, delayMs: 0 });

			const result = await pp.process([paragraph('one'), paragraph('two')].join('\n\n'));

			expect(result).toBe('Clean one.\n\nClean two.');
			expect(notify).not.toHaveBeenCalled();
		});

		it('applies the custom prompt to every section', async () => {
			const settings = longSettings((s) => {
				s.audio.postProcessing.customPrompt = 'Use British spelling';
			});
			const pp = new PostProcessor(() => settings, { delayMs: 0 });

			await pp.process([paragraph('one'), paragraph('two'), paragraph('three')].join('\n\n'));

			expect(completeSpy).toHaveBeenCalledTimes(3);
			for (const [prompt] of completeSpy.mock.calls) {
				expect(prompt).toContain('Use British spelling');
			}
		});

		it('waits the inter-call delay between sections', async () => {
			vi.useFakeTimers();
			try {
				const pp = new PostProcessor(() => longSettings());
				const pending = pp.process([paragraph('one'), paragraph('two'), paragraph('three')].join('\n\n'));

				await vi.advanceTimersByTimeAsync(0);
				expect(completeSpy).toHaveBeenCalledTimes(1);
				await vi.advanceTimersByTimeAsync(1999);
				expect(completeSpy).toHaveBeenCalledTimes(1);
				await vi.advanceTimersByTimeAsync(1);
				expect(completeSpy).toHaveBeenCalledTimes(2);
				await vi.advanceTimersByTimeAsync(2000);
				expect(completeSpy).toHaveBeenCalledTimes(3);
				await pending;
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
