import type { PostProcessingSettings, SynapseSettings } from '../settings';
import { AIClient, isWorthPostProcessing, redactError, sanitizeAIResponse, sleep } from '../shared';
import type { AIRequestOptions } from '../shared';
import { segmentTranscript, trimRepeatedContext, type TranscriptSegment } from './transcript-segmenter';

// Conservative chars-per-token estimate; real ratios are usually higher.
const CHARS_PER_TOKEN = 4;
// Share of ai.maxTokens a section may occupy, leaving headroom for a rewrite that grows.
const SECTION_TOKEN_SHARE = 0.6;
const OVERLAP_SHARE = 0.1;
// Matches the inter-file pause AudioModule uses between provider calls.
const INTER_CALL_DELAY_MS = 2000;

const SYSTEM_PROMPT =
	'You are a transcription editor. Process the following raw transcript according to the instructions. ' +
	'Preserve all meaning and key information. Output only the processed transcript.';

export interface PostProcessOptions {
	update?: (message: string) => void;
	/** Called for each AI call replayed from the response cache (#527). */
	onCacheHit?: () => void;
	/** Dispatch every AI pass fresh and overwrite its cache entry (#527). */
	bypassCache?: boolean;
}

function aiRequestOptions(opts: PostProcessOptions): AIRequestOptions {
	return { onCacheHit: opts.onCacheHit, bypassCache: opts.bypassCache };
}

export interface PostProcessorDeps {
	/** Sink for the single end-of-run notice when sections were kept raw. */
	notify?: (message: string) => void;
	delayMs?: number;
}

export class PostProcessor {
	private aiClient: AIClient;

	constructor(
		private getSettings: () => SynapseSettings,
		private deps: PostProcessorDeps = {}
	) {
		this.aiClient = new AIClient(getSettings);
	}

	async process(rawTranscript: string, opts: PostProcessOptions = {}): Promise<string> {
		const settings = this.getSettings().audio.postProcessing;
		if (!settings.enabled) return rawTranscript;
		// An editor prompt with no transcript under it makes the model invent one (#524).
		if (!isWorthPostProcessing(rawTranscript)) return rawTranscript;

		const keyPoints = settings.extractKeyPoints;
		const sectionInstructions = buildInstructions(settings, false);
		if (sectionInstructions.length === 0 && !keyPoints) return rawTranscript;

		const { maxTokens } = this.getSettings().ai;
		const estimatedTokens = Math.ceil(rawTranscript.length / CHARS_PER_TOKEN);
		if (estimatedTokens <= maxTokens) {
			const response = await this.aiClient.complete(
				`${formatInstructions(buildInstructions(settings, true))}\n\nRaw transcript:\n${rawTranscript}`,
				SYSTEM_PROMPT,
				aiRequestOptions(opts)
			);
			return sanitizeAIResponse(response);
		}

		return this.processInSections(rawTranscript, sectionInstructions, keyPoints, maxTokens, opts);
	}

	private async processInSections(
		rawTranscript: string,
		instructions: string[],
		keyPoints: boolean,
		maxTokens: number,
		opts: PostProcessOptions
	): Promise<string> {
		const sectionChars = Math.max(1, Math.floor(maxTokens * SECTION_TOKEN_SHARE * CHARS_PER_TOKEN));
		const segments = instructions.length > 0
			? segmentTranscript(rawTranscript, sectionChars, Math.floor(sectionChars * OVERLAP_SHARE))
			: [];
		const total = segments.length + (keyPoints ? 1 : 0);
		const delayMs = this.deps.delayMs ?? INTER_CALL_DELAY_MS;
		let calls = 0;
		const pace = async (): Promise<void> => {
			if (calls > 0 && delayMs > 0) await sleep(delayMs);
			calls++;
			opts.update?.(`Post-processing (${calls}/${total})`);
		};

		let text = rawTranscript;
		let keptRaw = 0;
		if (segments.length > 0) {
			const parts: string[] = [];
			for (let i = 0; i < segments.length; i++) {
				await pace();
				const processed = await this.processSection(segments[i], i, segments.length, instructions, maxTokens, opts);
				if (processed === null) keptRaw++;
				parts.push(processed ?? segments[i].body.trim());
			}
			text = parts.join('\n\n');
		}

		if (keyPoints) {
			await pace();
			const summary = await this.extractKeyPoints(text, opts);
			if (summary) text = `${text}\n\n${summary}`;
		}

		if (keptRaw > 0) {
			this.deps.notify?.(`Post-processing kept ${keptRaw} of ${segments.length} sections raw`);
		}
		return text;
	}

	/** Null means the section is kept raw: error, empty reply, or a reply that likely hit the token cap. */
	private async processSection(
		segment: TranscriptSegment,
		index: number,
		count: number,
		instructions: string[],
		maxTokens: number,
		opts: PostProcessOptions
	): Promise<string | null> {
		const sectionNote =
			`This is section ${index + 1} of ${count} of a longer transcript. Process only the text under "Transcript section". ` +
			'Any text under "Preceding context" was processed separately: use it for continuity only and do not repeat it. ' +
			'Do not add a title, introduction, or summary.';
		const context = segment.context ? `Preceding context:\n${segment.context}\n\n` : '';
		const prompt =
			`${formatInstructions([...instructions, sectionNote])}\n\n${context}Transcript section:\n${segment.body}`;
		try {
			const response = await this.aiClient.complete(prompt, SYSTEM_PROMPT, aiRequestOptions(opts));
			const cleaned = trimRepeatedContext(sanitizeAIResponse(response).trim(), segment.context);
			if (cleaned.length === 0) return null;
			if (Math.ceil(cleaned.length / CHARS_PER_TOKEN) >= maxTokens) return null;
			return cleaned;
		} catch (error) {
			console.warn(
				`[Synapse] Post-processing section ${index + 1}/${count} failed; keeping raw text`,
				redactError(error)
			);
			return null;
		}
	}

	private async extractKeyPoints(text: string, opts: PostProcessOptions): Promise<string | null> {
		const prompt =
			`${formatInstructions([
				'Write a "Key Points" section with bullet points summarizing the transcript. Output only that section, starting with a "Key Points" heading.',
			])}\n\nTranscript:\n${text}`;
		try {
			const summary = sanitizeAIResponse(
				await this.aiClient.complete(prompt, SYSTEM_PROMPT, aiRequestOptions(opts))
			).trim();
			return summary.length > 0 ? summary : null;
		} catch (error) {
			console.warn('[Synapse] Key points pass failed; transcript kept without key points', redactError(error));
			return null;
		}
	}
}

function buildInstructions(settings: PostProcessingSettings, includeKeyPoints: boolean): string[] {
	const instructions: string[] = [];
	if (settings.removeFiller) {
		instructions.push('Remove filler words (um, uh, like, you know) and false starts');
	}
	if (settings.addStructure) {
		instructions.push('Add proper punctuation, paragraph breaks, and section headers where appropriate');
	}
	if (includeKeyPoints && settings.extractKeyPoints) {
		instructions.push('Add a "Key Points" summary section at the top with bullet points');
	}
	if (settings.customPrompt) {
		instructions.push(settings.customPrompt);
	}
	return instructions;
}

function formatInstructions(instructions: string[]): string {
	return `Instructions:\n${instructions.map((i) => `- ${i}`).join('\n')}`;
}
